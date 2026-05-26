import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type Person,
  type SkillConfidence,
  type SkillProfile,
  type SkillTrait,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  SKILL_TRAIT_DETECT_JSON_SCHEMA,
  SKILL_TRAIT_DETECT_SCHEMA_NAME,
  SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
  SKILL_TRAIT_DETECT_USER_TEMPLATE,
} from '../prompts/skill-trait-detect.prompt';
import {
  SKILL_TRAIT_MERGE_JSON_SCHEMA,
  SKILL_TRAIT_MERGE_SCHEMA_NAME,
  SKILL_TRAIT_MERGE_SYSTEM_PROMPT,
  SKILL_TRAIT_MERGE_USER_TEMPLATE,
} from '../prompts/skill-trait-merge.prompt';

import { KnowledgeEmbeddingService } from './embedding.service';
import { SkillTraitConceptService } from './skill-trait-concept.service';
import { Specialist37ProbeService } from './specialist-3-7-skill-probe.service';

/**
 * SBA γ-1 — Specialist37Service (SkillProfile).
 *
 * Логика γ-1.3:
 *   1. Загружает subject-reasoning блоки сотрудника за SKILL_LOOKBACK_MONTHS.
 *   2. Группирует блоки по embedding similarity (KNN-greedy union-find 0.78).
 *   3. Для каждой группы >= SKILL_MIN_OBSERVATIONS — LLM skill-trait-detect.
 *   4. KNN-merge нового trait с активными (KNN cosine ≥ SKILL_TRAIT_SIMILARITY_THRESHOLD).
 *   5. Decay по lastConfirmedAt (>SKILL_DECAY_MONTHS → confidence↓;
 *      >SKILL_ARCHIVE_MONTHS → status='archived').
 *   6. Метрики core_specialist_*{type='skill_trait'}.
 *   7. Probe-events (через Specialist37ProbeService).
 *
 * Skill — НЕ pre-approval через CurationService (§3.6 F9): auto-canonical
 * при confidence>=medium. Manager может mark_as_misleading постфактум.
 */
@Injectable()
export class Specialist37Service {
  private readonly logger = new Logger(Specialist37Service.name);

  /** Имя специалиста (jobName-фильтр). */
  static readonly SPECIALIST_NAME = '3-7-skill';
  /** Тип ресурса для метрик. */
  static readonly METRIC_TYPE = 'skill_trait';
  /** KNN-cosine порог для группировки reasoning-блоков в кандидаты trait. */
  private static readonly GROUP_SIMILARITY_THRESHOLD = 0.78;
  /** Top-K кандидатов для skill-trait-merge KNN-арбитра. */
  private static readonly MERGE_KNN_TOP_K = 5;
  /** Максимум блоков, загружаемых из БД за один rebuild (защита от взрыва токенов). */
  private static readonly MAX_BLOCKS_PER_REBUILD = 200;
  /** Максимум групп, обрабатываемых LLM за один rebuild. */
  private static readonly MAX_GROUPS_PER_REBUILD = 12;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(Specialist37ProbeService)
    private readonly probes: Specialist37ProbeService,
    @Inject(SkillTraitConceptService)
    private readonly concepts: SkillTraitConceptService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  // ───────────────────── публичные методы ─────────────────────

  /**
   * Получить или создать SkillProfile для Person'а. Только для employee'ев.
   * Возвращает null, если Person — не сотрудник.
   */
  async getOrCreateForPerson(args: {
    tenantId: string;
    personId: string;
  }): Promise<SkillProfile | null> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        tenantId: true,
        relationship: true,
        deletedAt: true,
      },
    });
    if (!person || person.deletedAt) return null;
    if (person.tenantId !== args.tenantId) return null;
    if (person.relationship !== 'employee') return null;

    const existing = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.skillProfile.create({
        data: {
          tenantId: args.tenantId,
          personId: args.personId,
          status: 'active',
        },
      });
    } catch (err) {
      // Race: возможно уже создали в параллельном job'е → читаем.
      this.logger.debug(
        { personId: args.personId, err: err instanceof Error ? err.message : String(err) },
        'specialist-3-7.getOrCreateForPerson: race / упало — re-read',
      );
      return this.prisma.skillProfile.findUnique({
        where: { personId: args.personId },
      });
    }
  }

  /**
   * Пересборка профиля. Вызывается из SkillProfileRebuildWorker.
   *
   * Best-effort: ошибки на каждом шаге не пробрасываются, только метрика +
   * лог. BullMQ-retry политика — на стороне воркера.
   */
  async rebuildProfile(args: { profileId: string }): Promise<void> {
    const start = Date.now();
    try {
      const profile = await this.prisma.skillProfile.findUnique({
        where: { id: args.profileId },
        include: {
          person: {
            select: {
              id: true,
              tenantId: true,
              name: true,
              entityId: true,
              relationship: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!profile) {
        this.logger.debug({ profileId: args.profileId }, 'specialist-3-7: profile не найден — skip');
        return;
      }
      if (profile.person.deletedAt) {
        this.logger.debug({ profileId: args.profileId }, 'specialist-3-7: person удалён — skip');
        return;
      }

      // 1. Lifecycle по relationship.
      const newStatus = this.statusForRelationship(profile.person.relationship);
      if (newStatus !== profile.status) {
        await this.prisma.skillProfile.update({
          where: { id: profile.id },
          data: { status: newStatus },
        });
        if (newStatus !== 'active') {
          this.logger.debug(
            { profileId: profile.id, status: newStatus },
            'specialist-3-7: profile переведён в неактивный статус — skip rebuild',
          );
          return;
        }
      }
      if (profile.person.relationship !== 'employee') {
        return; // не employee — rebuild не делаем.
      }

      // 2. Загрузить subject-reasoning блоки за окно.
      const blocks = await this.loadSubjectReasoningBlocks({
        tenantId: profile.tenantId,
        entityId: profile.person.entityId,
        lookbackMonths: this.cfg.skill.lookbackMonths,
      });
      const minObservations = this.cfg.skill.minObservations;
      if (blocks.length < minObservations) {
        this.logger.debug(
          { profileId: profile.id, blocksCount: blocks.length, minObservations },
          'specialist-3-7: блоков меньше порога — skip',
        );
        // Probe: пустой профиль (стартует сам по cron'у, не здесь).
        return;
      }

      // 3. Группировать блоки по embedding similarity → кандидаты на traits.
      const groups = await this.groupBlocksBySimilarity(blocks);
      const eligibleGroups = groups
        .filter((g) => g.length >= minObservations)
        .slice(0, Specialist37Service.MAX_GROUPS_PER_REBUILD);
      this.logger.debug(
        {
          profileId: profile.id,
          blocksCount: blocks.length,
          groupsTotal: groups.length,
          eligibleGroups: eligibleGroups.length,
        },
        'specialist-3-7: группировка завершена',
      );

      // 4. Для каждой группы → LLM detect → KNN-merge.
      let createdNew = 0;
      let mergedCount = 0;
      let supersededCount = 0;
      for (const group of eligibleGroups) {
        const draft = await this.detectTrait({
          profile,
          personName: profile.person.name,
          group,
        });
        if (!draft) continue;

        const result = await this.mergeOrCreate({ profile, draft });
        if (result === 'created') createdNew++;
        else if (result === 'merged') mergedCount++;
        else if (result === 'superseded') supersededCount++;
      }

      // 5. Decay активных traits.
      await this.runDecay(profile.id);

      // 6. Обновить версию.
      await this.prisma.skillProfile.update({
        where: { id: profile.id },
        data: {
          lastBuildAt: new Date(),
          buildVersion: profile.buildVersion + 1,
        },
      });

      this.metrics.incCoreSpecialistCards({
        type: Specialist37Service.METRIC_TYPE,
        status: 'canonical',
      });

      this.logger.log(
        {
          profileId: profile.id,
          personId: profile.person.id,
          createdNew,
          mergedCount,
          supersededCount,
        },
        'specialist-3-7: rebuild завершён',
      );

      // 7. Probe-events.
      await this.probes.checkAndEmitProbes({
        tenantId: profile.tenantId,
        profileId: profile.id,
        personId: profile.person.id,
        personName: profile.person.name,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'rebuild_error',
      });
      this.logger.error(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.rebuildProfile: внутренняя ошибка',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: Specialist37Service.METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }
  }

  /**
   * EventEmitter-обработчик 'person.relationship_changed'.
   * Любой код в проекте, меняющий Person.relationship, может эмиттить
   * это событие — Specialist37Service обновит SkillProfile.status.
   *
   * Payload: { personId, newRelationship, oldRelationship? }.
   *
   * NB: если событие не эмиттится — это безопасно, так как rebuildProfile
   * самостоятельно проверяет relationship в начале и сам перекладывает
   * статус (см. statusForRelationship).
   */
  @OnEvent('person.relationship_changed')
  async onRelationshipChanged(args: {
    personId: string;
    newRelationship: Person['relationship'];
    oldRelationship?: Person['relationship'];
  }): Promise<void> {
    await this.handleRelationshipChange({
      personId: args.personId,
      newRelationship: args.newRelationship,
    });
  }

  /**
   * Хук на смену Person.relationship — обновляет SkillProfile.status.
   */
  async handleRelationshipChange(args: {
    personId: string;
    newRelationship: Person['relationship'];
  }): Promise<void> {
    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
    });
    if (!profile) return;
    const desired = this.statusForRelationship(args.newRelationship);
    if (desired === profile.status) return;
    try {
      await this.prisma.skillProfile.update({
        where: { id: profile.id },
        data: { status: desired },
      });
      this.logger.log(
        { profileId: profile.id, oldStatus: profile.status, newStatus: desired },
        'specialist-3-7.handleRelationshipChange: обновлён статус',
      );
    } catch (err) {
      this.logger.warn(
        {
          profileId: profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.handleRelationshipChange: не удалось обновить — skip',
      );
    }
  }

  // ─────────────────────── приватные методы ───────────────────────

  /**
   * Маппинг relationship → желаемый SkillProfile.status.
   */
  private statusForRelationship(
    rel: Person['relationship'],
  ): SkillProfile['status'] {
    if (rel === 'employee') return 'active';
    if (rel === 'former') return 'archived';
    return 'paused_relationship'; // candidate | external
  }

  /**
   * Загружает блоки за окно, где Person упомянут как subject AND
   * signalType ∈ {reasoning, rationale, decision_basis}. Возвращает блоки
   * со свежими первыми (для удобства группировки).
   */
  private async loadSubjectReasoningBlocks(args: {
    tenantId: string;
    entityId: string | null;
    lookbackMonths: number;
  }): Promise<
    Array<{
      blockId: string;
      name: string;
      trustedAnswer: string;
      tags: string[];
      createdAt: Date;
      quote: string;
      embedding: number[] | null;
    }>
  > {
    if (!args.entityId) return [];

    const lookbackMs = args.lookbackMonths * 30 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs);

    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: args.entityId,
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
      take: Specialist37Service.MAX_BLOCKS_PER_REBUILD,
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];
    if (blockIds.length === 0) return [];

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        tags: true,
        createdAt: true,
        evidence: {
          select: { quote: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Embedding read через raw query (pgvector).
    const embeddings = await this.loadEmbeddings(blocks.map((b) => b.id));

    return blocks.map((b) => ({
      blockId: b.id,
      name: b.name,
      trustedAnswer: b.trustedAnswer ?? '',
      tags: b.tags,
      createdAt: b.createdAt,
      quote: b.evidence[0]?.quote ?? b.trustedAnswer ?? b.name,
      embedding: embeddings.get(b.id) ?? null,
    }));
  }

  /**
   * Читает IdeaBlock.embedding через pgvector raw query. Возвращает мапу
   * blockId → number[]. Блоки без embedding не попадут в карту.
   */
  private async loadEmbeddings(blockIds: string[]): Promise<Map<string, number[]>> {
    if (blockIds.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; emb: string | null }>
      >`SELECT "id", "embedding"::text AS "emb" FROM "IdeaBlock" WHERE "id" IN (${Prisma.join(blockIds)}) AND "embedding" IS NOT NULL`;
      const map = new Map<string, number[]>();
      for (const r of rows) {
        if (!r.emb) continue;
        // pgvector text формат: '[0.1,0.2,...]'
        const inner = r.emb.replace(/^\[|\]$/g, '');
        if (!inner) continue;
        const vec = inner.split(',').map((s) => Number(s));
        if (vec.every((n) => Number.isFinite(n))) {
          map.set(r.id, vec);
        }
      }
      return map;
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-7.loadEmbeddings: упал, fallback на пустую мапу',
      );
      return new Map();
    }
  }

  /**
   * Группировка блоков методом greedy union-find по cosine similarity.
   * Блоки без embedding идут в свои одноблочные группы (не теряем материал,
   * но не сольём с другими).
   */
  private async groupBlocksBySimilarity(
    blocks: Array<{
      blockId: string;
      quote: string;
      embedding: number[] | null;
    }>,
  ): Promise<Array<typeof blocks>> {
    const threshold = Specialist37Service.GROUP_SIMILARITY_THRESHOLD;
    const groups: Array<typeof blocks> = [];
    for (const block of blocks) {
      if (!block.embedding) {
        groups.push([block]);
        continue;
      }
      let placed = false;
      for (const g of groups) {
        // Сравниваем с первым представителем группы (greedy).
        const head = g[0];
        if (!head || !head.embedding) continue;
        const sim = cosineSimilarity(block.embedding, head.embedding);
        if (sim >= threshold) {
          g.push(block);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([block]);
    }
    // Отсортировать группы по размеру (большие — приоритет).
    return groups.sort((a, b) => b.length - a.length);
  }

  /**
   * LLM-extraction черновика trait'а из группы блоков. Best-effort.
   */
  private async detectTrait(args: {
    profile: SkillProfile;
    personName: string;
    group: Array<{
      blockId: string;
      quote: string;
      createdAt?: Date;
    }>;
  }): Promise<TraitDraft | null> {
    const quotesForLlm = args.group
      .slice(0, 12)
      .map((b) => ({
        blockId: b.blockId,
        quote: b.quote,
        observedAt: (b.createdAt ?? new Date()).toISOString(),
      }));

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (цитаты, исходно из транскриптов).
    const guardOnDetect = this.isPromptInjectionGuardEnabled();
    const rawUserDetect = SKILL_TRAIT_DETECT_USER_TEMPLATE({
      personName: args.personName,
      personRole: null,
      quotes: quotesForLlm,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'skill-trait-detect',
        systemPrompt: guardOnDetect
          ? withInjectionGuard(SKILL_TRAIT_DETECT_SYSTEM_PROMPT)
          : SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnDetect ? wrapUserData(rawUserDetect) : rawUserDetect,
        tenantId: args.profile.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: SKILL_TRAIT_DETECT_SCHEMA_NAME,
          schema: SKILL_TRAIT_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profile.id },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.detectTrait: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist37Service.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    return parseTraitDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason,
      });
    });
  }

  /**
   * KNN-merge нового trait'а с существующими активными traits того же
   * profileId. Применяет verdict: 'merge' / 'supersedes' / 'new'.
   */
  private async mergeOrCreate(args: {
    profile: SkillProfile;
    draft: TraitDraft;
  }): Promise<'created' | 'merged' | 'superseded' | 'skipped'> {
    const threshold = this.cfg.skill.traitSimilarityThreshold;

    // KNN-кандидаты через pgvector.
    let candidates: Array<{
      id: string;
      category: string;
      statement: string;
      confidence: SkillConfidence;
      lastConfirmedAt: Date;
      observationCount: number;
      sourceBlockIds: string[];
    }> = [];

    let embedding: number[] | null;
    try {
      embedding = await this.embedder.embedQuery(
        `${args.draft.category}. ${args.draft.statement}`.slice(0, 2_000),
      );
    } catch {
      embedding = null;
    }

    if (embedding) {
      try {
        const vec = `[${embedding.join(',')}]`;
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{
            id: string;
            category: string;
            statement: string;
            confidence: SkillConfidence;
            lastConfirmedAt: Date;
            observationCount: number;
            sourceBlockIds: string[];
            distance: number;
          }>
        >(
          `SELECT "id", "category", "statement", "confidence", "lastConfirmedAt",
                  "observationCount", "sourceBlockIds",
                  ("embedding" <=> $2::vector) AS "distance"
           FROM "skill_traits"
           WHERE "profileId" = $1
             AND "status" = 'active'
             AND "embedding" IS NOT NULL
           ORDER BY "embedding" <=> $2::vector
           LIMIT ${Specialist37Service.MERGE_KNN_TOP_K}`,
          args.profile.id,
          vec,
        );
        // cosine_distance = 1 - cosine_sim. Фильтруем по threshold по близости.
        candidates = rows
          .filter((r) => 1 - r.distance >= threshold)
          .map((r) => ({
            id: r.id,
            category: r.category,
            statement: r.statement,
            confidence: r.confidence,
            lastConfirmedAt: r.lastConfirmedAt,
            observationCount: r.observationCount,
            sourceBlockIds: r.sourceBlockIds ?? [],
          }));
      } catch (err) {
        this.logger.debug(
          {
            profileId: args.profile.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-7.mergeOrCreate: pgvector KNN упал — fallback к verdict=new',
        );
      }
    }

    if (candidates.length === 0) {
      return this.createNewTrait({
        profile: args.profile,
        draft: args.draft,
        embedding,
      });
    }

    // LLM-арбитр.
    const verdict = await this.callMergeArbiter({
      tenantId: args.profile.tenantId,
      profileId: args.profile.id,
      draft: args.draft,
      candidates,
    });

    if (verdict.verdict === 'merge' && verdict.targetId) {
      const target = candidates.find((c) => c.id === verdict.targetId);
      if (!target) {
        return this.createNewTrait({
          profile: args.profile,
          draft: args.draft,
          embedding,
        });
      }
      await this.mergeIntoExisting({
        profileId: args.profile.id,
        existing: target,
        draft: args.draft,
      });
      return 'merged';
    }

    if (verdict.verdict === 'supersedes' && verdict.targetId) {
      const target = candidates.find((c) => c.id === verdict.targetId);
      if (!target) {
        return this.createNewTrait({
          profile: args.profile,
          draft: args.draft,
          embedding,
        });
      }
      const newTraitId = await this.createNewTraitRaw({
        profile: args.profile,
        draft: args.draft,
        embedding,
      });
      if (!newTraitId) return 'skipped';
      await this.prisma.skillTrait.update({
        where: { id: target.id },
        data: { status: 'superseded_by', supersededById: newTraitId },
      });
      return 'superseded';
    }

    return this.createNewTrait({
      profile: args.profile,
      draft: args.draft,
      embedding,
    });
  }

  private async callMergeArbiter(args: {
    tenantId: string;
    profileId: string;
    draft: TraitDraft;
    candidates: Array<{
      id: string;
      category: string;
      statement: string;
      confidence: SkillConfidence;
      lastConfirmedAt: Date;
    }>;
  }): Promise<MergeVerdict> {
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (draft + кандидаты, исходно из транскриптов).
    const guardOnMerge = this.isPromptInjectionGuardEnabled();
    const rawUserMerge = SKILL_TRAIT_MERGE_USER_TEMPLATE({
      draft: {
        category: args.draft.category,
        statement: args.draft.statement,
        confidence: args.draft.confidence,
      },
      candidates: args.candidates.map((c) => ({
        id: c.id,
        category: c.category,
        statement: c.statement,
        confidence: c.confidence,
        lastConfirmedAt: c.lastConfirmedAt.toISOString(),
      })),
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'skill-trait-merge',
        systemPrompt: guardOnMerge
          ? withInjectionGuard(SKILL_TRAIT_MERGE_SYSTEM_PROMPT)
          : SKILL_TRAIT_MERGE_SYSTEM_PROMPT,
        userMessage: guardOnMerge ? wrapUserData(rawUserMerge) : rawUserMerge,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: SKILL_TRAIT_MERGE_SCHEMA_NAME,
          schema: SKILL_TRAIT_MERGE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profileId },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'arbiter_skip',
      });
      this.logger.warn(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.callMergeArbiter: LLM упал — fallback к verdict=new',
      );
      return { verdict: 'new', targetId: null, reasoning: 'arbiter_skipped' };
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist37Service.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    try {
      const parsed = JSON.parse(result.text) as MergeVerdict;
      if (
        parsed.verdict !== 'merge' &&
        parsed.verdict !== 'supersedes' &&
        parsed.verdict !== 'new'
      ) {
        return { verdict: 'new', targetId: null, reasoning: 'invalid_verdict' };
      }
      const candidateIds = new Set(args.candidates.map((c) => c.id));
      if (
        parsed.verdict !== 'new' &&
        parsed.targetId &&
        !candidateIds.has(parsed.targetId)
      ) {
        return {
          verdict: 'new',
          targetId: null,
          reasoning: 'targetId_not_in_candidates',
        };
      }
      return parsed;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'arbiter_json_parse',
      });
      return { verdict: 'new', targetId: null, reasoning: 'arbiter_parse_failed' };
    }
  }

  private async createNewTrait(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    embedding: number[] | null;
  }): Promise<'created' | 'skipped'> {
    const id = await this.createNewTraitRaw(args);
    return id ? 'created' : 'skipped';
  }

  private async createNewTraitRaw(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    embedding: number[] | null;
  }): Promise<string | null> {
    try {
      const trait = await this.prisma.skillTrait.create({
        data: {
          profileId: args.profile.id,
          category: args.draft.category.slice(0, 200),
          statement: args.draft.statement.slice(0, 2_000),
          confidence: args.draft.confidence as SkillConfidence,
          observationCount: Math.max(
            1,
            Math.min(1_000, args.draft.sourceBlockIds.length),
          ),
          sourceBlockIds: args.draft.sourceBlockIds.slice(0, 50),
          firstObservedAt: this.safeDate(args.draft.firstObservedAt),
          lastConfirmedAt: this.safeDate(args.draft.lastConfirmedAt),
          status: 'active',
        },
      });
      if (args.embedding) {
        try {
          const vec = `[${args.embedding.join(',')}]`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE "skill_traits" SET "embedding" = $1::vector WHERE "id" = $2`,
            vec,
            trait.id,
          );
        } catch {
          // best-effort
        }
      }
      // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — привязать trait к
      // смысловому блоку навыка (SkillTraitConcept). Best-effort: ошибка не
      // должна валить insert уже созданного trait'а.
      try {
        const concept = await this.concepts.findOrCreateConcept({
          tenantId: args.profile.tenantId,
          category: args.draft.category,
          statement: args.draft.statement,
        });
        if (concept) {
          await this.prisma.skillTrait.update({
            where: { id: trait.id },
            data: { conceptId: concept.id },
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            traitId: trait.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-7.createNewTraitRaw: concept-link упал — trait остаётся без concept (подхватит cron)',
        );
      }
      return trait.id;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'db_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.createNewTraitRaw: insert упал',
      );
      return null;
    }
  }

  private async mergeIntoExisting(args: {
    profileId: string;
    existing: {
      id: string;
      sourceBlockIds: string[];
      observationCount: number;
    };
    draft: TraitDraft;
  }): Promise<void> {
    const merged = new Set([
      ...args.existing.sourceBlockIds,
      ...args.draft.sourceBlockIds,
    ]);
    try {
      await this.prisma.skillTrait.update({
        where: { id: args.existing.id },
        data: {
          sourceBlockIds: [...merged],
          observationCount: Math.min(1_000, merged.size),
          confidence: args.draft.confidence as SkillConfidence,
          lastConfirmedAt: this.safeDate(args.draft.lastConfirmedAt),
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          traitId: args.existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.mergeIntoExisting: update упал — skip',
      );
    }
  }

  /**
   * Decay: traits без подтверждения N мес → confidence↓; >2N мес → archive.
   */
  private async runDecay(profileId: string): Promise<void> {
    const decayCutoff = new Date(
      Date.now() - this.cfg.skill.decayMonths * 30 * 24 * 60 * 60 * 1000,
    );
    const archiveCutoff = new Date(
      Date.now() - this.cfg.skill.archiveMonths * 30 * 24 * 60 * 60 * 1000,
    );

    try {
      // Archive: status='active' AND lastConfirmedAt < archiveCutoff.
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          lastConfirmedAt: { lt: archiveCutoff },
        },
        data: { status: 'archived' },
      });

      // Decay confidence: high → medium → low (если lastConfirmed < decayCutoff).
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          confidence: 'high',
          lastConfirmedAt: { lt: decayCutoff },
        },
        data: { confidence: 'medium' },
      });
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          confidence: 'medium',
          lastConfirmedAt: { lt: decayCutoff },
        },
        data: { confidence: 'low' },
      });
    } catch (err) {
      this.logger.warn(
        {
          profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.runDecay: упал — skip',
      );
    }
  }

  /**
   * Получить SkillProfile сотрудника (для Clone API).
   */
  async getEmployeeProfile(args: {
    tenantId: string;
    personId: string;
  }): Promise<(SkillProfile & { traits: SkillTrait[] }) | null> {
    return this.prisma.skillProfile.findFirst({
      where: { tenantId: args.tenantId, personId: args.personId },
      include: {
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });
  }

  private safeDate(input: string | null | undefined): Date {
    if (!input) return new Date();
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return new Date();
    return d;
  }
}

// ─────────────────────── shared types ───────────────────────

export interface TraitDraft {
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
}

interface MergeVerdict {
  verdict: 'merge' | 'supersedes' | 'new';
  targetId: string | null;
  reasoning: string;
}

// ─────────────────────── helpers ───────────────────────

function parseTraitDraft(
  text: string,
  onFailure: (reason: string) => void,
): TraitDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    onFailure('json_parse');
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    onFailure('schema_validation');
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const category = typeof obj.category === 'string' ? obj.category.trim() : '';
  const statement = typeof obj.statement === 'string' ? obj.statement.trim() : '';
  const confidenceRaw = obj.confidence;
  const confidence =
    confidenceRaw === 'low' || confidenceRaw === 'medium' || confidenceRaw === 'high'
      ? confidenceRaw
      : null;
  if (!category || !statement || !confidence) {
    onFailure('schema_validation');
    return null;
  }
  const sourceBlockIds: string[] = [];
  if (Array.isArray(obj.sourceBlockIds)) {
    for (const id of obj.sourceBlockIds) {
      if (typeof id === 'string' && id.length > 0) sourceBlockIds.push(id);
    }
  }
  const firstObservedAt =
    typeof obj.firstObservedAt === 'string' && obj.firstObservedAt.length > 0
      ? obj.firstObservedAt
      : new Date().toISOString();
  const lastConfirmedAt =
    typeof obj.lastConfirmedAt === 'string' && obj.lastConfirmedAt.length > 0
      ? obj.lastConfirmedAt
      : new Date().toISOString();
  return {
    category,
    statement,
    confidence,
    sourceBlockIds,
    firstObservedAt,
    lastConfirmedAt,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
