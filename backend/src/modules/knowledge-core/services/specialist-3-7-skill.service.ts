import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type Person,
  type SkillConfidence,
  type SkillProfile,
  type SkillTrait,
  type SkillTraitLayer,
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
  PROCESS_MARKER_DETECT_JSON_SCHEMA,
  PROCESS_MARKER_DETECT_SCHEMA_NAME,
  PROCESS_MARKER_DETECT_SYSTEM_PROMPT,
  PROCESS_MARKER_DETECT_USER_TEMPLATE,
} from '../prompts/process-marker-detect.prompt';
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
import {
  SKILL_TRAIT_VERIFY_JSON_SCHEMA,
  SKILL_TRAIT_VERIFY_SCHEMA_NAME,
  SKILL_TRAIT_VERIFY_SYSTEM_PROMPT,
  SKILL_TRAIT_VERIFY_USER_TEMPLATE,
} from '../prompts/skill-trait-verify.prompt';
import {
  VALUE_MOTIVATION_DETECT_JSON_SCHEMA,
  VALUE_MOTIVATION_DETECT_SCHEMA_NAME,
  VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT,
  VALUE_MOTIVATION_DETECT_USER_TEMPLATE,
} from '../prompts/value-motivation-detect.prompt';

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
  /** Ф5(F) — нижний порог попадания в арбитраж merge. Кандидаты в [0.78,0.85)
   *  («band») всё равно судятся арбитром (не форс-new), но мерджатся только при
   *  совпадении смысловой категории. ≥0.85 — «hard». */
  private static readonly ARBITRATION_FLOOR = 0.78;
  /** Максимум блоков, загружаемых из БД за один rebuild (защита от взрыва токенов). */
  private static readonly MAX_BLOCKS_PER_REBUILD = 200;
  /** Максимум групп, обрабатываемых LLM за один rebuild. */
  private static readonly MAX_GROUPS_PER_REBUILD = 12;
  /**
   * TZ clone-method Э2.1 — код-гард детектора маркеров процесса (как гард
   * Э1.2 в RolePrincipleSynthesisService): statement с любым из стоп-маркеров
   * оценочных осей («избегает решений», «не решает сам», …) отбрасывается
   * независимо от того, что решила модель. Сверка по нижнему регистру,
   * намеренно консервативная (substring) — лучше потерять маркер, чем
   * пропустить кадрово-токсичный приговор.
   */
  private static readonly PROCESS_MARKER_STOP_MARKERS: readonly string[] = [
    'избегает',
    'не решает сам',
    'зависим',
    'нерешителен',
    'медлителен',
    'не способен',
    'боится',
  ];

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
   * Ф3(D) — grounding-проверка pending_verification черт перед попаданием в
   * персону. grounded=true → active; иначе остаётся pending (decay уберёт).
   * Fail-open (Р2): ошибка/таймаут LLM → промоут в active (как было до D).
   *
   * Вызывается из SkillTraitVerifyCron батчем (default limit 100).
   */
  async verifyPendingTraits(
    limit = 100,
  ): Promise<{ checked: number; promoted: number; held: number }> {
    let checked = 0;
    let promoted = 0;
    let held = 0;
    try {
      const pending = await this.prisma.skillTrait.findMany({
        where: { status: 'pending_verification' },
        select: {
          id: true,
          category: true,
          statement: true,
          sourceBlockIds: true,
          profileId: true,
          profile: { select: { tenantId: true } },
        },
        take: limit,
      });

      for (const trait of pending) {
        checked++;
        const tenantId = trait.profile?.tenantId ?? null;
        try {
          // Цитаты-источники: дословные reasoning-блоки (critical/trusted).
          const blockIds = trait.sourceBlockIds.slice(0, 10);
          const blocks = blockIds.length
            ? await this.prisma.ideaBlock.findMany({
                where: { id: { in: blockIds } },
                select: {
                  id: true,
                  criticalQuestion: true,
                  trustedAnswer: true,
                },
              })
            : [];
          const quotes = blocks.map((b) => ({
            blockId: b.id,
            quote: `${b.criticalQuestion} ${b.trustedAnswer}`.slice(0, 600),
          }));

          const res = await this.llm.call({
            taskType: 'skill-trait-verify',
            systemPrompt: SKILL_TRAIT_VERIFY_SYSTEM_PROMPT,
            userMessage: SKILL_TRAIT_VERIFY_USER_TEMPLATE({
              category: trait.category,
              statement: trait.statement,
              quotes,
            }),
            tenantId,
            responseFormat: {
              type: 'json_schema',
              name: SKILL_TRAIT_VERIFY_SCHEMA_NAME,
              schema: SKILL_TRAIT_VERIFY_JSON_SCHEMA,
              strict: true,
            },
            sourceRef: { type: 'skill_profile', id: trait.profileId },
            dataClass: 'internal',
          });

          const parsed = JSON.parse(res.text) as { grounded?: unknown };
          const grounded = parsed.grounded === true;
          if (grounded) {
            await this.prisma.skillTrait.update({
              where: { id: trait.id },
              data: { status: 'active' },
            });
            promoted++;
          } else {
            // Не грунтовано — оставляем pending (decay уберёт).
            held++;
          }
        } catch (err) {
          // FAIL-OPEN (Р2): ошибка LLM/parse → промоут в active, не блокируем
          // формирование клона из-за недоступности верификатора.
          this.logger.warn(
            {
              traitId: trait.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-7.verifyPendingTraits: verify упал — fail-open promote в active',
          );
          try {
            await this.prisma.skillTrait.update({
              where: { id: trait.id },
              data: { status: 'active' },
            });
            promoted++;
          } catch (updErr) {
            this.logger.warn(
              {
                traitId: trait.id,
                err:
                  updErr instanceof Error ? updErr.message : String(updErr),
              },
              'specialist-3-7.verifyPendingTraits: fail-open update тоже упал — skip',
            );
          }
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-7.verifyPendingTraits: выборка/проход упали',
      );
      return { checked, promoted, held };
    }
    return { checked, promoted, held };
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
      // Ф4(E) — split-floor: профиль-порог (сколько всего блоков нужно) и
      // кластер-порог (сколько в группе) — разные AdminSetting-крутилки.
      const profileMinObservations = await this.cfg.getDynamic<number>(
        'knowledge.skillProfileMinObservations',
        undefined,
        this.cfg.skill.minObservations,
      );
      if (blocks.length < profileMinObservations) {
        this.logger.debug(
          { profileId: profile.id, blocksCount: blocks.length, profileMinObservations },
          'specialist-3-7: блоков меньше порога — skip',
        );
        // Probe: пустой профиль (стартует сам по cron'у, не здесь).
        return;
      }
      const clusterMinObservations = await this.cfg.getDynamic<number>(
        'knowledge.skillClusterMinObservations',
        undefined,
        3,
      );

      // 3. Группировать блоки по embedding similarity → кандидаты на traits.
      const groups = await this.groupBlocksBySimilarity(blocks);
      const eligibleGroups = groups
        .filter((g) => g.length >= clusterMinObservations)
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

      // TZ clone-method Э1.3 — детектор ценностей/мотивации (revealed preferences).
      // Второй проход по тем же группам; пишет SkillTrait layer=value|motivation.
      // Kill-switch: cfg.skill.valueMotivationDetectEnabled.
      if (this.cfg.skill.valueMotivationDetectEnabled) {
        for (const group of eligibleGroups) {
          const draft = await this.detectValueMotivation({
            profile,
            personName: profile.person.name,
            group,
          });
          if (!draft) continue;

          const result = await this.mergeOrCreate({
            profile,
            draft,
            layer: draft.layer,
          });
          if (result === 'created') createdNew++;
          else if (result === 'merged') mergedCount++;
          else if (result === 'superseded') supersededCount++;
        }
      }

      // TZ clone-method Э2.1 — детектор конструктивных маркеров процесса.
      // Третий проход по тем же группам; пишет SkillTrait layer=process_marker.
      // Kill-switch: cfg.skill.processMarkerDetectEnabled.
      if (this.cfg.skill.processMarkerDetectEnabled) {
        for (const group of eligibleGroups) {
          const draft = await this.detectProcessMarker({
            profile,
            personName: profile.person.name,
            group,
          });
          if (!draft) continue;

          const result = await this.mergeOrCreate({
            profile,
            draft,
            layer: 'process_marker',
          });
          if (result === 'created') createdNew++;
          else if (result === 'merged') mergedCount++;
          else if (result === 'superseded') supersededCount++;
        }
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
   * TZ clone-method Э1.3 — LLM-extraction ценности/мотивации из «решающего
   * момента» (trade-off) в той же группе reasoning-блоков. Близнец
   * detectTrait: тот же injection-guard, но taskType
   * `value-motivation-detect` и схема со слоем layer ∈ {value, motivation}.
   * Нет явного trade-off (sourceBlockIds=[]) → null — это НОРМА, не ошибка.
   * Best-effort.
   */
  private async detectValueMotivation(args: {
    profile: SkillProfile;
    personName: string;
    group: Array<{
      blockId: string;
      quote: string;
      createdAt?: Date;
    }>;
  }): Promise<(TraitDraft & { layer: 'value' | 'motivation' }) | null> {
    const quotesForLlm = args.group
      .slice(0, 12)
      .map((b) => ({
        blockId: b.blockId,
        quote: b.quote,
        observedAt: (b.createdAt ?? new Date()).toISOString(),
      }));

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (цитаты, исходно из транскриптов).
    const guardOnDetect = this.isPromptInjectionGuardEnabled();
    const rawUserDetect = VALUE_MOTIVATION_DETECT_USER_TEMPLATE({
      personName: args.personName,
      personRole: null,
      quotes: quotesForLlm,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'value-motivation-detect',
        systemPrompt: guardOnDetect
          ? withInjectionGuard(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT)
          : VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnDetect ? wrapUserData(rawUserDetect) : rawUserDetect,
        tenantId: args.profile.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: VALUE_MOTIVATION_DETECT_SCHEMA_NAME,
          schema: VALUE_MOTIVATION_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profile.id },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'value_motivation',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.detectValueMotivation: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'value_motivation',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    const draft = parseValueMotivationDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'value_motivation',
        reason,
      });
    });
    if (!draft) return null;
    // Пустой sourceBlockIds = «решающего момента нет» — норма, не failure.
    if (draft.sourceBlockIds.length === 0) return null;
    return draft;
  }

  /**
   * TZ clone-method Э2.1 — LLM-extraction конструктивного МАРКЕРА ПРОЦЕССА
   * (повторяемого приёма проработки решений) из той же группы
   * reasoning-блоков. Близнец detectValueMotivation: тот же injection-guard,
   * но taskType `process-marker-detect`; layer из LLM НЕ приходит — слой
   * фиксирован детектором ('process_marker'). Поверх парса — код-гард
   * стоп-маркеров оценочных осей (как гард Э1.2): «избегает», «не решает
   * сам» и т.п. в statement → null + warn. Нет повторяемого приёма
   * (sourceBlockIds=[]) → null — это НОРМА, не ошибка. Best-effort.
   */
  private async detectProcessMarker(args: {
    profile: SkillProfile;
    personName: string;
    group: Array<{
      blockId: string;
      quote: string;
      createdAt?: Date;
    }>;
  }): Promise<(TraitDraft & { layer: 'process_marker' }) | null> {
    const quotesForLlm = args.group
      .slice(0, 12)
      .map((b) => ({
        blockId: b.blockId,
        quote: b.quote,
        observedAt: (b.createdAt ?? new Date()).toISOString(),
      }));

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (цитаты, исходно из транскриптов).
    const guardOnDetect = this.isPromptInjectionGuardEnabled();
    const rawUserDetect = PROCESS_MARKER_DETECT_USER_TEMPLATE({
      personName: args.personName,
      personRole: null,
      quotes: quotesForLlm,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'process-marker-detect',
        systemPrompt: guardOnDetect
          ? withInjectionGuard(PROCESS_MARKER_DETECT_SYSTEM_PROMPT)
          : PROCESS_MARKER_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnDetect ? wrapUserData(rawUserDetect) : rawUserDetect,
        tenantId: args.profile.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROCESS_MARKER_DETECT_SCHEMA_NAME,
          schema: PROCESS_MARKER_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profile.id },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'process_marker',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.detectProcessMarker: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'process_marker',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    // layer из LLM не приходит (схема без layer) — переиспользуем parseTraitDraft.
    const draft = parseTraitDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'process_marker',
        reason,
      });
    });
    if (!draft) return null;
    // Пустой sourceBlockIds = «повторяемого приёма нет» — норма, не failure.
    if (draft.sourceBlockIds.length === 0) return null;

    // Код-гард (как Э1.2): оценочно-диагностическая лексика → отбросить.
    const lower = draft.statement.toLowerCase();
    const stopMarker = Specialist37Service.PROCESS_MARKER_STOP_MARKERS.find(
      (m) => lower.includes(m),
    );
    if (stopMarker) {
      this.logger.warn(
        {
          profileId: args.profile.id,
          marker: stopMarker,
          category: draft.category,
        },
        'specialist-3-7.detectProcessMarker: оценочная лексика в statement — отбрасываю (rejected_guard)',
      );
      return null;
    }

    // Слой фиксирован детектором — LLM его не присылает.
    return { ...draft, layer: 'process_marker' };
  }

  /**
   * KNN-merge нового trait'а с существующими активными traits того же
   * profileId. Применяет verdict: 'merge' / 'supersedes' / 'new'.
   */
  private async mergeOrCreate(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    /** TZ clone-method Э1.3 — слой черты; KNN-кандидаты и insert идут строго
     *  в своём слое (value-черта не мёрджится со skill-чертой). Default 'skill'. */
    layer?: SkillTraitLayer;
  }): Promise<'created' | 'merged' | 'superseded' | 'skipped'> {
    const layer: SkillTraitLayer = args.layer ?? 'skill';
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
      bucket: 'hard' | 'band';
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
             AND "layer" = $3::"SkillTraitLayer"
             AND "embedding" IS NOT NULL
           ORDER BY "embedding" <=> $2::vector
           LIMIT ${Specialist37Service.MERGE_KNN_TOP_K}`,
          args.profile.id,
          vec,
          layer,
        );
        // cosine_distance = 1 - cosine_sim. Ф5(F): фильтруем по ARBITRATION_FLOOR
        // (0.78) — кандидаты в [0.78,threshold) («band») всё равно судятся арбитром
        // (не форс-new), но помечаются как слабое совпадение. rows уже отсортированы
        // по distance asc = similarity desc; cap top-3.
        candidates = rows
          .filter((r) => 1 - r.distance >= Specialist37Service.ARBITRATION_FLOOR)
          .slice(0, 3)
          .map((r) => ({
            id: r.id,
            category: r.category,
            statement: r.statement,
            confidence: r.confidence,
            lastConfirmedAt: r.lastConfirmedAt,
            observationCount: r.observationCount,
            sourceBlockIds: r.sourceBlockIds ?? [],
            bucket: (1 - r.distance >= threshold ? 'hard' : 'band') as
              | 'hard'
              | 'band',
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
        layer,
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
          layer,
        });
      }
      await this.mergeIntoExisting({
        profileId: args.profile.id,
        existing: {
          id: target.id,
          sourceBlockIds: target.sourceBlockIds,
          observationCount: target.observationCount,
          confidence: target.confidence,
        },
        draft: args.draft,
        embedding,
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
          layer,
        });
      }
      const newTraitId = await this.createNewTraitRaw({
        profile: args.profile,
        draft: args.draft,
        embedding,
        layer,
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
      layer,
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
      bucket: 'hard' | 'band';
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
        bucket: c.bucket,
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
    /** TZ clone-method Э1.3 — слой черты (default 'skill'). */
    layer?: SkillTraitLayer;
  }): Promise<'created' | 'skipped'> {
    const id = await this.createNewTraitRaw(args);
    return id ? 'created' : 'skipped';
  }

  private async createNewTraitRaw(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    embedding: number[] | null;
    /** TZ clone-method Э1.3 — слой черты (default 'skill'). */
    layer?: SkillTraitLayer;
  }): Promise<string | null> {
    try {
      const trait = await this.prisma.skillTrait.create({
        data: {
          profileId: args.profile.id,
          // TZ clone-method Э1.3 — слой черты (skill | value | motivation | …).
          layer: args.layer ?? 'skill',
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
          // Ф3(D) — новая черта создаётся в pending_verification: в персону
          // НЕ попадает, пока skill-trait-verify cron не подтвердит grounding
          // (grounded=true → active; ошибка LLM → fail-open active).
          status: 'pending_verification',
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
      confidence: SkillConfidence;
    };
    draft: TraitDraft;
    embedding: number[] | null;
  }): Promise<void> {
    const merged = new Set([
      ...args.existing.sourceBlockIds,
      ...args.draft.sourceBlockIds,
    ]);

    // Ф2-B (Р6) — confidence пересчитывается из разброса РАЗНЫХ ДАТ наблюдений
    // (число различных дней по createdAt блоков), НЕ из числа блоков: одна
    // болтливая встреча не должна дать ложный `high`. Уже достигнутый уровень
    // не понижаем (MAX(текущий, evidence-floor)).
    let newConfidence: SkillConfidence = args.existing.confidence;
    try {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: [...merged] } },
        select: { createdAt: true },
      });
      const distinctDays = new Set(
        blocks.map((b) => b.createdAt.toISOString().slice(0, 10)),
      ).size;
      const evidenceLevel: SkillConfidence =
        distinctDays >= 4 ? 'high' : distinctDays >= 2 ? 'medium' : 'low';
      newConfidence = this.maxConfidence(args.existing.confidence, evidenceLevel);
    } catch (err) {
      // Fail-open: не смогли пересчитать — оставляем существующий уровень.
      this.logger.debug(
        {
          traitId: args.existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.mergeIntoExisting: пересчёт confidence из дат упал — оставляем текущий',
      );
    }

    // Ф2-C (Р7) — якорь statement+embedding обновляем ТОЛЬКО ВМЕСТЕ: есть
    // непустой draft.statement И передан embedding. Иначе ни то, ни другое
    // (откат к старому). Обе записи в ОДНОЙ транзакции — при ошибке
    // откатываются вместе.
    const updateAnchor =
      args.embedding != null && args.draft.statement.trim().length > 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.skillTrait.update({
          where: { id: args.existing.id },
          data: {
            sourceBlockIds: [...merged],
            observationCount: Math.min(1_000, merged.size),
            confidence: newConfidence,
            lastConfirmedAt: this.safeDate(args.draft.lastConfirmedAt),
            ...(updateAnchor
              ? { statement: args.draft.statement.slice(0, 2_000) }
              : {}),
          },
        });
        if (updateAnchor && args.embedding) {
          const vec = `[${args.embedding.join(',')}]`;
          await tx.$executeRawUnsafe(
            `UPDATE "skill_traits" SET "embedding" = $1::vector WHERE "id" = $2`,
            vec,
            args.existing.id,
          );
        }
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
   * Ф2-B — MAX по лестнице уверенности (low<medium<high): не понижаем уже
   * достигнутый уровень черты при пересчёте из разброса дат.
   */
  private maxConfidence(a: SkillConfidence, b: SkillConfidence): SkillConfidence {
    const RANK: Record<SkillConfidence, number> = { low: 0, medium: 1, high: 2 };
    return RANK[a] >= RANK[b] ? a : b;
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

      // Decay confidence на ОДНУ ступень за проход.
      // порядок: medium→low ДО high→medium — иначе high упадёт в low за один
      // проход (свежеставший из high `medium` иначе попал бы во второй шаг).
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          confidence: 'medium',
          lastConfirmedAt: { lt: decayCutoff },
        },
        data: { confidence: 'low' },
      });
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          confidence: 'high',
          lastConfirmedAt: { lt: decayCutoff },
        },
        data: { confidence: 'medium' },
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
  /** TZ clone-method Э1.3 — слой черты. Отсутствует у основного
   *  skill-trait-detect (трактуется как 'skill'); у value-motivation-detect
   *  обязателен и ∈ {value, motivation}. */
  layer?: 'skill' | 'value' | 'motivation' | 'process_marker';
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
  // TZ clone-method Э1.3 — опциональный слой черты; невалидное значение
  // просто отбрасывается (основной skill-путь слой не присылает).
  const layerRaw = obj.layer;
  const layer =
    layerRaw === 'skill' ||
    layerRaw === 'value' ||
    layerRaw === 'motivation' ||
    layerRaw === 'process_marker'
      ? layerRaw
      : undefined;
  return {
    category,
    statement,
    confidence,
    sourceBlockIds,
    firstObservedAt,
    lastConfirmedAt,
    ...(layer ? { layer } : {}),
  };
}

/**
 * TZ clone-method Э1.3 — парсер ответа `value-motivation-detect`: тот же
 * TraitDraft, но layer ОБЯЗАТЕЛЕН и строго ∈ {value, motivation}.
 */
function parseValueMotivationDraft(
  text: string,
  onFailure: (reason: string) => void,
): (TraitDraft & { layer: 'value' | 'motivation' }) | null {
  const draft = parseTraitDraft(text, onFailure);
  if (!draft) return null;
  if (draft.layer !== 'value' && draft.layer !== 'motivation') {
    onFailure('schema_validation');
    return null;
  }
  return draft as TraitDraft & { layer: 'value' | 'motivation' };
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
