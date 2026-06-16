import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SkillConfidence, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  ROLE_PRINCIPLE_SYNTHESIZE_JSON_SCHEMA,
  ROLE_PRINCIPLE_SYNTHESIZE_SCHEMA_NAME,
  ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT,
  ROLE_PRINCIPLE_SYNTHESIZE_USER_TEMPLATE,
} from '../prompts/role-principle-synthesize.prompt';

import { KnowledgeEmbeddingService } from './embedding.service';

/**
 * TZ clone-method Э1.2 (2026-06-12) — RolePrincipleSynthesisService
 * (Reflection-слой, закрывает R3/R4).
 *
 * Из накопленных reasoning-блоков ВСЕХ носителей одной должности синтезирует
 * обобщённые принципы процесса (`RolePrinciple`) с grounding-ссылками:
 *   1. personIds роли = UNION PersonRole(validTo=null, deprecated) +
 *      Appointment(validTo=null, status active|acting) — поддерживаем оба
 *      мира, т.к. persona-build живёт на PersonRole.
 *   2. Person(employee, entityId) → subject-reasoning блоки за
 *      SKILL_LOOKBACK_MONTHS (как Specialist37Service.loadSubjectReasoningBlocks).
 *   3. Порог `knowledge.rolePrincipleMinObservations` (AdminSetting, default 5)
 *      — ниже порога LLM НЕ вызывается.
 *   4. Greedy-группировка по embedding (cosine ≥ 0.78, как
 *      groupBlocksBySimilarity 3.7) → top-8 групп size ≥ 2.
 *   5. ОДИН LLM-вызов `role-principle-synthesize` (json_schema strict).
 *   6. Валидация: statement/situation непусты, sourceBlockIds ⊆ входных и
 *      ≥ 2, код-гард против диагностической лексики (стоп-маркеры).
 *   7. Дедуп по embedding (cosine ≥ `knowledge.rolePrincipleDedupThreshold`,
 *      default 0.85): совпадение → merge в существующий active-принцип,
 *      иначе create + raw-апдейт вектора.
 *
 * Best-effort: ошибки LLM/парса → warn + `{skipped:'llm_error'}` без throw.
 */
@Injectable()
export class RolePrincipleSynthesisService {
  private readonly logger = new Logger(RolePrincipleSynthesisService.name);

  /** Тип ресурса для метрик core_specialist_* (учёт LLM-токенов). */
  static readonly METRIC_TYPE = 'role_principle';
  /** KNN-cosine порог greedy-группировки блоков по ситуациям (как 3.7). */
  private static readonly GROUP_SIMILARITY_THRESHOLD = 0.78;
  /** Максимум блоков, загружаемых за один synthesize (защита от взрыва токенов). */
  private static readonly MAX_BLOCKS_PER_SYNTHESIS = 200;
  /** Top-N групп по размеру, отправляемых в LLM. */
  private static readonly MAX_GROUPS_PER_SYNTHESIS = 8;
  /** Максимум цитат на группу в user-промпте. */
  private static readonly MAX_QUOTES_PER_GROUP = 10;
  /** Cap длины sourceBlockIds у принципа. */
  private static readonly MAX_SOURCE_BLOCK_IDS = 50;
  /**
   * Код-гард против негативно-диагностической лексики о носителе
   * (Personality Illusion): statement с любым из стоп-маркеров отбрасывается
   * независимо от того, что решила модель. Сверка по нижнему регистру.
   */
  private static readonly DIAGNOSTIC_STOP_MARKERS: readonly string[] = [
    'избегает',
    'не решает сам',
    'не способен',
    'боится',
    'ленив',
    'безответствен',
    'некомпетент',
    'слаб',
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Синтез принципов процесса для одной должности. Best-effort: никогда
   * не бросает — при проблеме возвращает `skipped` с причиной.
   */
  async synthesizeForRole(args: {
    tenantId: string;
    roleId: string;
  }): Promise<{ created: number; merged: number; skipped: string | null }> {
    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.tenantId !== args.tenantId || role.deletedAt) {
      return { created: 0, merged: 0, skipped: 'role_not_found' };
    }

    // 1. Носители роли: UNION PersonRole (deprecated, но persona-build на нём)
    //    и Appointment (актуальный мир) — открытые назначения.
    const [personRoleRows, appointmentRows] = await Promise.all([
      this.prisma.personRole.findMany({
        where: { tenantId: args.tenantId, roleId: args.roleId, validTo: null },
        select: { personId: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          validTo: null,
          status: { in: ['active', 'acting'] },
        },
        select: { personId: true },
      }),
    ]);
    const personIds = [
      ...new Set(
        [...personRoleRows, ...appointmentRows].map((r) => r.personId),
      ),
    ];
    if (personIds.length === 0) {
      return { created: 0, merged: 0, skipped: 'no_persons' };
    }

    // 2. Только employee с entityId — иначе нечего искать в графе.
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        id: { in: personIds },
        relationship: 'employee',
        deletedAt: null,
        entityId: { not: null },
      },
      select: { entityId: true },
    });
    const entityIds = persons
      .map((p) => p.entityId)
      .filter((id): id is string => typeof id === 'string');
    if (entityIds.length === 0) {
      return { created: 0, merged: 0, skipped: 'no_entities' };
    }

    // 3. Subject-reasoning блоки носителей за lookback-окно (как 3.7).
    const lookbackMs =
      this.cfg.skill.lookbackMonths * 30 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs);
    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: { in: entityIds },
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
      take: RolePrincipleSynthesisService.MAX_BLOCKS_PER_SYNTHESIS,
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];

    // 4. Порог наблюдений (AdminSetting-крутилка) — ниже порога LLM не зовём.
    const minObs = await this.cfg.getDynamic<number>(
      'knowledge.rolePrincipleMinObservations',
      undefined,
      5,
    );
    if (blockIds.length < minObs) {
      return { created: 0, merged: 0, skipped: 'below_threshold' };
    }

    const rows = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        createdAt: true,
        evidence: { select: { quote: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    const embeddings = await this.loadEmbeddings(rows.map((b) => b.id));
    const blocks = rows.map((b) => ({
      blockId: b.id,
      quote: b.evidence[0]?.quote ?? b.trustedAnswer ?? b.name,
      observedAt: b.createdAt.toISOString(),
      embedding: embeddings.get(b.id) ?? null,
    }));

    // 5. Greedy-группировка по ситуациям: size ≥ 2, top-8, ≤10 цитат на группу.
    const groups = this.groupBlocksBySimilarity(blocks)
      .filter((g) => g.length >= 2)
      .slice(0, RolePrincipleSynthesisService.MAX_GROUPS_PER_SYNTHESIS);
    if (groups.length === 0) {
      return { created: 0, merged: 0, skipped: 'no_groups' };
    }

    const promptGroups = groups.map((g) => ({
      label: (g[0]?.quote ?? '').slice(0, 60),
      quotes: g
        .slice(0, RolePrincipleSynthesisService.MAX_QUOTES_PER_GROUP)
        .map((b) => ({
          blockId: b.blockId,
          quote: b.quote,
          observedAt: b.observedAt,
        })),
    }));
    const inputIds = new Set(blocks.map((b) => b.blockId));

    // 6-7. Один LLM-вызов + парс + валидация. Best-effort.
    let drafts: PrincipleDraft[];
    try {
      const result = await this.llm.call({
        taskType: 'role-principle-synthesize',
        systemPrompt: ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT,
        userMessage: ROLE_PRINCIPLE_SYNTHESIZE_USER_TEMPLATE({
          roleName: role.name,
          groups: promptGroups,
        }),
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: ROLE_PRINCIPLE_SYNTHESIZE_SCHEMA_NAME,
          schema: ROLE_PRINCIPLE_SYNTHESIZE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'role_principle', id: args.roleId },
        dataClass: 'internal',
        maxTokens: 8_000,
      });
      if (result.modelUsed) {
        this.metrics.incCoreSpecialistLlmTokens({
          type: RolePrincipleSynthesisService.METRIC_TYPE,
          model: result.modelUsed,
          tier: result.tier ?? 'primary',
          tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
        });
      }
      drafts = this.parseAndValidate(result.text, inputIds, args.roleId);
    } catch (err) {
      this.logger.warn(
        {
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-principle-synthesis: LLM/парс упал — skip роли',
      );
      return { created: 0, merged: 0, skipped: 'llm_error' };
    }

    // 8. Дедуп/upsert каждого принципа (per-principle best-effort).
    const dedupThreshold = await this.cfg.getDynamic<number>(
      'knowledge.rolePrincipleDedupThreshold',
      undefined,
      0.85,
    );
    let created = 0;
    let merged = 0;
    for (const draft of drafts) {
      try {
        const outcome = await this.upsertPrinciple({
          tenantId: args.tenantId,
          roleId: args.roleId,
          draft,
          dedupThreshold,
        });
        if (outcome === 'created') {
          created++;
          this.metrics.incRolePrincipleSynthesized({ outcome: 'created' });
        } else if (outcome === 'merged') {
          merged++;
          this.metrics.incRolePrincipleSynthesized({ outcome: 'merged' });
        }
      } catch (err) {
        this.logger.warn(
          {
            roleId: args.roleId,
            situation: draft.situation,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-principle-synthesis: upsert принципа упал — пропускаю',
        );
      }
    }

    return { created, merged, skipped: null };
  }

  // ───────────────────── парс + валидация ─────────────────────

  /**
   * JSON.parse + пер-принципная валидация: непустые situation/statement,
   * sourceBlockIds ⊆ входных и ≥ 2, код-гард диагностической лексики.
   * Невалидный JSON / не-массив principles → throw (caller вернёт llm_error).
   */
  private parseAndValidate(
    text: string,
    inputIds: ReadonlySet<string>,
    roleId: string,
  ): PrincipleDraft[] {
    const parsed: unknown = JSON.parse(text);
    const principles = (parsed as { principles?: unknown }).principles;
    if (!Array.isArray(principles)) {
      throw new Error('role-principle-synthesize: нет массива principles');
    }

    const out: PrincipleDraft[] = [];
    for (const raw of principles) {
      const obj = raw as Record<string, unknown>;
      const situation =
        typeof obj.situation === 'string' ? obj.situation.trim() : '';
      const statement =
        typeof obj.statement === 'string' ? obj.statement.trim() : '';
      if (!situation || !statement) {
        this.logger.warn(
          { roleId },
          'role-principle-synthesis: пустой situation/statement — отбрасываю',
        );
        continue;
      }

      const sourceBlockIds = Array.isArray(obj.sourceBlockIds)
        ? obj.sourceBlockIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          )
        : [];
      const uniqueIds = [...new Set(sourceBlockIds)];
      const isSubset = uniqueIds.every((id) => inputIds.has(id));
      if (!isSubset || uniqueIds.length < 2) {
        this.logger.warn(
          { roleId, situation, sourceBlockIds: uniqueIds },
          'role-principle-synthesis: sourceBlockIds не подмножество входных или < 2 — отбрасываю',
        );
        continue;
      }

      // Код-гард: диагностическая лексика о носителе → отбросить.
      const lower = statement.toLowerCase();
      const marker = RolePrincipleSynthesisService.DIAGNOSTIC_STOP_MARKERS.find(
        (m) => lower.includes(m),
      );
      if (marker) {
        this.logger.warn(
          { roleId, situation, marker },
          'role-principle-synthesis: диагностическая лексика в statement — отбрасываю (rejected_guard)',
        );
        this.metrics.incRolePrincipleSynthesized({
          outcome: 'rejected_guard',
        });
        continue;
      }

      const confidence: SkillConfidence =
        obj.confidence === 'low' ||
        obj.confidence === 'medium' ||
        obj.confidence === 'high'
          ? obj.confidence
          : 'low';

      out.push({
        situation,
        statement,
        sourceBlockIds: uniqueIds.slice(
          0,
          RolePrincipleSynthesisService.MAX_SOURCE_BLOCK_IDS,
        ),
        confidence,
      });
    }
    return out;
  }

  // ───────────────────── дедуп / upsert ─────────────────────

  private async upsertPrinciple(args: {
    tenantId: string;
    roleId: string;
    draft: PrincipleDraft;
    dedupThreshold: number;
  }): Promise<'created' | 'merged'> {
    const embedding = await this.embedder.embedQuery(
      `${args.draft.situation}. ${args.draft.statement}`.slice(0, 2_000),
    );

    if (embedding) {
      const existing = await this.findClosestActivePrinciple({
        tenantId: args.tenantId,
        roleId: args.roleId,
        embedding,
        threshold: args.dedupThreshold,
      });
      if (existing) {
        await this.mergeIntoExisting({ existing, draft: args.draft, embedding });
        return 'merged';
      }
    }

    await this.createNewPrincipleRaw({
      tenantId: args.tenantId,
      roleId: args.roleId,
      draft: args.draft,
      embedding,
    });
    return 'created';
  }

  /**
   * Top-1 cosine-поиск ближайшего active RolePrinciple той же роли
   * (raw pgvector, образец findClosestActiveConcept).
   */
  private async findClosestActivePrinciple(args: {
    tenantId: string;
    roleId: string;
    embedding: number[];
    threshold: number;
  }): Promise<{
    id: string;
    sourceBlockIds: string[];
    observationCount: number;
    confidence: SkillConfidence;
  } | null> {
    const vec = `[${args.embedding.join(',')}]`;
    // cosine_distance = 1 - similarity ⇒ similarity >= threshold
    // ⇔ distance <= 1 - threshold.
    const maxDistance = 1 - args.threshold;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; distance: number }>
    >(
      `SELECT id, ("embedding" <=> $1::vector) AS distance
         FROM "role_principles"
        WHERE "tenantId" = $2
          AND "roleId" = $3
          AND "status" = 'active'
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> $1::vector ASC
        LIMIT 1`,
      vec,
      args.tenantId,
      args.roleId,
    );
    const top = rows[0];
    if (!top) return null;
    if (typeof top.distance !== 'number' || top.distance > maxDistance) {
      return null;
    }
    const found = await this.prisma.rolePrinciple.findUnique({
      where: { id: top.id },
      select: {
        id: true,
        sourceBlockIds: true,
        observationCount: true,
        confidence: true,
      },
    });
    return found ?? null;
  }

  /**
   * Merge в существующий принцип: union sourceBlockIds (cap 50),
   * observationCount = размер union, confidence = MAX по рангу,
   * statement обновляется ВМЕСТЕ с embedding в одной транзакции
   * (образец mergeIntoExisting 3.7).
   */
  private async mergeIntoExisting(args: {
    existing: {
      id: string;
      sourceBlockIds: string[];
      observationCount: number;
      confidence: SkillConfidence;
    };
    draft: PrincipleDraft;
    embedding: number[];
  }): Promise<void> {
    const union = new Set([
      ...args.existing.sourceBlockIds,
      ...args.draft.sourceBlockIds,
    ]);
    const cappedIds = [...union].slice(
      0,
      RolePrincipleSynthesisService.MAX_SOURCE_BLOCK_IDS,
    );
    // Б9 — confidence из разброса РАЗНЫХ ДАТ union-блоков (не сырой вердикт
    // LLM); уже достигнутый уровень не понижаем (MAX(текущий, evidence-floor)).
    // Fail-open внутри хелпера: при ошибке вернётся текущий уровень existing.
    const evidenceLevel = await this.confidenceFromDistinctDays(
      [...union],
      args.existing.confidence,
    );
    const confidence = this.maxConfidence(
      args.existing.confidence,
      evidenceLevel,
    );
    const vec = `[${args.embedding.join(',')}]`;
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePrinciple.update({
        where: { id: args.existing.id },
        data: {
          sourceBlockIds: cappedIds,
          observationCount: union.size,
          confidence,
          statement: args.draft.statement.slice(0, 2_000),
          lastSynthesizedAt: new Date(),
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE "role_principles" SET "embedding" = $1::vector WHERE "id" = $2`,
        vec,
        args.existing.id,
      );
    });
  }

  /**
   * Create + raw-апдейт вектора (образец createNewTraitRaw 3.7: pgvector
   * Unsupported — пишется только $executeRawUnsafe).
   */
  private async createNewPrincipleRaw(args: {
    tenantId: string;
    roleId: string;
    draft: PrincipleDraft;
    embedding: number[] | null;
  }): Promise<void> {
    // Б9 — confidence из разброса РАЗНЫХ ДАТ блоков-источников, НЕ сырой
    // вердикт LLM (принцип создаётся сразу active, без pending-гейта — ложный
    // `high` от одной болтливой встречи сразу попал бы в персону). Fail-open
    // внутри хелпера: при ошибке вернётся `low`.
    const confidence = await this.confidenceFromDistinctDays(
      args.draft.sourceBlockIds,
      'low',
    );
    const created = await this.prisma.rolePrinciple.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        situation: args.draft.situation.slice(0, 200),
        statement: args.draft.statement.slice(0, 2_000),
        sourceBlockIds: args.draft.sourceBlockIds,
        observationCount: args.draft.sourceBlockIds.length,
        confidence,
        status: 'active',
        lastSynthesizedAt: new Date(),
      },
    });
    // Б10 — raw-апдейт вектора best-effort (try/catch, как createNewTraitRaw
    // 3.7): сбой записи embedding НЕ должен валить уже созданный принцип; но и
    // строка с embedding=NULL невидима дедупу (`findClosestActivePrinciple`
    // фильтрует IS NOT NULL) → каждый прогон плодит дубль. Поэтому при сбое
    // вектора best-effort удаляем только что созданную строку (компенсация):
    // лучше «нет принципа в этот прогон» (подхватит следующий), чем «active
    // без вектора, вечный дубль».
    if (args.embedding) {
      const vec = `[${args.embedding.join(',')}]`;
      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "role_principles" SET "embedding" = $1::vector WHERE "id" = $2`,
          vec,
          created.id,
        );
      } catch (err) {
        this.logger.warn(
          {
            roleId: args.roleId,
            principleId: created.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-principle-synthesis.createNewPrincipleRaw: запись embedding упала — откатываю принцип (иначе active без вектора невидим дедупу → дубль)',
        );
        try {
          await this.prisma.rolePrinciple.delete({ where: { id: created.id } });
        } catch {
          // best-effort: не смогли откатить — оставляем строку, дедуп
          // подхватит её по statement-merge на следующем прогоне в худшем
          // случае; throw не делаем, чтобы не валить остальные принципы.
        }
      }
    }
  }

  /** MAX по лестнице уверенности (low<medium<high) — не понижаем достигнутое. */
  private maxConfidence(
    a: SkillConfidence,
    b: SkillConfidence,
  ): SkillConfidence {
    const RANK: Record<SkillConfidence, number> = { low: 0, medium: 1, high: 2 };
    return RANK[a] >= RANK[b] ? a : b;
  }

  /**
   * Б9 (контракт M5) — confidence принципа = функция РАЗБРОСА РАЗНЫХ ДАТ
   * наблюдений (число различных дней по `createdAt` блоков), НЕ сырой вердикт
   * LLM и НЕ число блоков: одна болтливая встреча (N блоков одной даты) не
   * должна дать ложный `high`. Лестница как в `specialist-3-7-skill`
   * (≥4 дней → high / ≥2 → medium / иначе low).
   *
   * Fail-open: не смогли пересчитать (нет блоков / ошибка БД) → `fallback`
   * (для create — `low`, для merge — текущий уровень existing).
   */
  private async confidenceFromDistinctDays(
    blockIds: string[],
    fallback: SkillConfidence,
  ): Promise<SkillConfidence> {
    if (blockIds.length === 0) return fallback;
    try {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: blockIds } },
        select: { createdAt: true },
      });
      if (blocks.length === 0) return fallback;
      const distinctDays = new Set(
        blocks.map((b) => b.createdAt.toISOString().slice(0, 10)),
      ).size;
      return distinctDays >= 4 ? 'high' : distinctDays >= 2 ? 'medium' : 'low';
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'role-principle-synthesis.confidenceFromDistinctDays: пересчёт из дат упал — fallback',
      );
      return fallback;
    }
  }

  // ───────────────────── embeddings + группировка ─────────────────────

  /**
   * Читает IdeaBlock.embedding через pgvector raw query (как 3.7).
   * Блоки без embedding не попадут в карту.
   */
  private async loadEmbeddings(
    blockIds: string[],
  ): Promise<Map<string, number[]>> {
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
        'role-principle-synthesis.loadEmbeddings: упал — fallback на пустую мапу',
      );
      return new Map();
    }
  }

  /**
   * Greedy-группировка блоков по cosine similarity с первым представителем
   * группы (подход groupBlocksBySimilarity 3.7). Блоки без embedding —
   * одноблочные группы (отфильтруются порогом size ≥ 2).
   */
  private groupBlocksBySimilarity<
    T extends { embedding: number[] | null },
  >(blocks: T[]): T[][] {
    const threshold = RolePrincipleSynthesisService.GROUP_SIMILARITY_THRESHOLD;
    const groups: T[][] = [];
    for (const block of blocks) {
      if (!block.embedding) {
        groups.push([block]);
        continue;
      }
      let placed = false;
      for (const g of groups) {
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
    return groups.sort((a, b) => b.length - a.length);
  }
}

/** Провалидированный черновик принципа из ответа LLM. */
interface PrincipleDraft {
  situation: string;
  statement: string;
  sourceBlockIds: string[];
  confidence: SkillConfidence;
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
