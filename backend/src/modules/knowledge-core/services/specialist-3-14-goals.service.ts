import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  type DataClass,
  type Goal,
  type GoalHorizon,
  type GoalProgressStatus,
  type IdeaBlock,
  type IdeaBlockEvidence,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { SystemLogPipeline } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
import {
  GOAL_EXTRACT_JSON_SCHEMA,
  GOAL_EXTRACT_SCHEMA_NAME,
  GOAL_EXTRACT_SYSTEM_PROMPT,
  GOAL_EXTRACT_USER_TEMPLATE,
} from '../prompts/goal-extract.prompt';
import {
  GOAL_HIERARCHY_LINK_JSON_SCHEMA,
  GOAL_HIERARCHY_LINK_SCHEMA_NAME,
  GOAL_HIERARCHY_LINK_SYSTEM_PROMPT,
  GOAL_HIERARCHY_LINK_USER_TEMPLATE,
} from '../prompts/goal-hierarchy-link.prompt';

import { KnowledgeEmbeddingService } from './embedding.service';
import { GoalTaskLinkerService } from './goal-task-linker.service';
import { GoalThemeLinkerService } from './goal-theme-linker.service';

/** Метрика-тип для core_specialist_*. */
const METRIC_TYPE = 'goal';

const VALID_HORIZONS: ReadonlySet<string> = new Set([
  'strategic',
  'annual',
  'quarterly',
  'monthly',
  'sprint',
]);

/**
 * Goals OKR v2 (2026-06-02, Фаза 2) — Specialist314GoalsService.
 *
 * Логика специалиста 3-14: блок (signalType ∈ {commitment, plan_item}) →
 * черновик Goal (LLM `goal-extract`, может вернуть «не цель») → KNN-кандидаты
 * существующих целей → LLM-арбитр `goal-hierarchy-link` (duplicate / child_of /
 * standalone) → создание Goal (source='ai', promotionState=suggested|active по
 * confidence) + опц. измеримый GoalKeyResult.
 *
 * Зафиксированные решения (см. ТЗ §5 Фаза 2 + промпт оркестратора):
 *   - Триггер: commitment + plan_item (НЕ decision).
 *   - promotionState: 'suggested'; confidence >= AUTO_PROMOTE → 'active'.
 *   - duplicate → promote existing (если suggested) / skip; child_of →
 *     parentGoalId; standalone → root. Нет KNN-кандидатов → standalone без LLM.
 *   - Cap фокуса MAX_ACTIVE_GOALS_PER_HORIZON: при превышении не плодим.
 *   - MIN_EXTRACT_CONFIDENCE — ниже = «не цель», skip.
 *   - Entity{type=goal} в этой фазе НЕ создаём (entityId=null; backfill — вне scope).
 *   - Ф5 (TZ 2026-06-16): KNN-дедуп по семантике (`Goal.embedding`, pgvector
 *     cosine, HNSW) вместо ILIKE по 2 словам; ILIKE остаётся best-effort
 *     fallback'ом при отсутствии вектора. + source-block guard (Б34).
 *   - Goal.createdById обязателен (FK на User onDelete:Restrict) — подставляем
 *     owner'а Org (Membership role='owner'); нет owner → любой
 *     член Org (joinedAt asc); Org вообще без членов → skip создания + WARN.
 *
 * Метрики — переиспользуем `core_specialist_*{type='goal'}`.
 */
@Injectable()
export class Specialist314GoalsService {
  private readonly logger = new Logger(Specialist314GoalsService.name);

  static readonly SPECIALIST_NAME = '3-14-goals';
  /** Top-K для KNN-кандидатов дедупа/иерархии. */
  private static readonly KNN_TOP_K = 5;
  /** Минимальная уверенность extraction, ниже которой блок — «не цель». */
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;
  /** Confidence, при которой AI-цель сразу промоутится в 'active'. */
  private static readonly AUTO_PROMOTE_CONFIDENCE = 0.8;
  /** Cap фокуса: > N active+suggested целей одного горизонта — не плодим. */
  private static readonly MAX_ACTIVE_GOALS_PER_HORIZON = 7;

  /**
   * Agent-chain overhaul Фаза 4.2 (2026-06-07) — детерминированный линкер
   * Goal↔Theme. Инжектится property-injection'ом (не через конструктор), чтобы
   * не сдвигать позиционные аргументы существующих unit-тестов. @Optional:
   * в spec-конструкторе (positional) сервис не передаётся — хук тогда no-op.
   */
  @Optional()
  @Inject(GoalThemeLinkerService)
  private readonly goalThemeLinker?: GoalThemeLinkerService;

  /**
   * Agent-chain overhaul Фаза 4.1 (2026-06-08) — LLM-привязка задач встречи к
   * новой AI-цели (`goal-task-link`, DEFAULT OFF). Тот же property-injection
   * паттерн, что и goalThemeLinker (не сдвигаем позиционные аргументы тестов).
   * @Optional: в spec-конструкторе сервис не передаётся → хук no-op.
   */
  @Optional()
  @Inject(GoalTaskLinkerService)
  private readonly goalTaskLinker?: GoalTaskLinkerService;

  /**
   * Ф5 (TZ 2026-06-16 task-dedup) — enqueue пересчёта `Goal.embedding` после
   * создания AI-цели (для семантического KNN-дедупа следующих целей). Тот же
   * property-injection паттерн, что и goalThemeLinker (не сдвигаем позиционные
   * аргументы существующих unit-тестов). @Optional: в spec-конструкторе сервис
   * не передаётся → enqueue no-op.
   */
  @Optional()
  @Inject(CoreQueueService)
  private readonly coreQueue?: CoreQueueService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LogService) private readonly logs: LogService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private async resolveThresholds(): Promise<GoalThresholds> {
    const [minExtractConfidence, autoPromoteConfidence, maxActiveGoalsPerHorizon] =
      await Promise.all([
        this.cfg?.getDynamic<number>(
          'goals.minExtractConfidence',
          undefined,
          Specialist314GoalsService.MIN_EXTRACT_CONFIDENCE,
        ),
        this.cfg?.getDynamic<number>(
          'goals.autoPromoteConfidence',
          undefined,
          Specialist314GoalsService.AUTO_PROMOTE_CONFIDENCE,
        ),
        this.cfg?.getDynamic<number>(
          'goals.maxActiveGoalsPerHorizon',
          undefined,
          Specialist314GoalsService.MAX_ACTIVE_GOALS_PER_HORIZON,
        ),
      ]);
    return {
      minExtractConfidence:
        minExtractConfidence ?? Specialist314GoalsService.MIN_EXTRACT_CONFIDENCE,
      autoPromoteConfidence:
        autoPromoteConfidence ?? Specialist314GoalsService.AUTO_PROMOTE_CONFIDENCE,
      maxActiveGoalsPerHorizon:
        maxActiveGoalsPerHorizon ??
        Specialist314GoalsService.MAX_ACTIVE_GOALS_PER_HORIZON,
    };
  }

  /** ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection. */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  // ───────────────────── публичный метод (вызывается из воркера) ─────────────

  /**
   * Обработка одного IdeaBlock. Последовательность (ТЗ §5 Фаза 2):
   *   1. load block (+ evidence).
   *   2. extract draft (LLM goal-extract; null если «не цель» / низкий confidence).
   *   3. KNN-кандидаты существующих целей.
   *   4. арбитр иерархии (LLM goal-hierarchy-link) либо standalone (нет кандидатов).
   *   5. применить verdict: duplicate→promote/skip; child_of→create с parentGoalId;
   *      standalone→create root. Cap-проверка перед созданием.
   *   6. опц. создать GoalKeyResult (если draft.measurable).
   */
  async processBlock(args: {
    tenantId: string;
    blockId: string;
  }): Promise<void> {
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id_tenantId: { id: args.blockId, tenantId: args.tenantId } },
      include: { evidence: true },
    });
    if (!block) return;
    if (block.tenantId !== args.tenantId) return;

    const thresholds = await this.resolveThresholds();

    const draft = await this.extractGoalDraft(block, thresholds.minExtractConfidence);
    if (!draft) {
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-14-goals',
        action: 'skipped',
        message: 'Goal не извлечена (не цель / низкий confidence)',
        orgId: block.tenantId,
        details: { type: 'goal', reason: 'no_draft', blockId: block.id },
      });
      return;
    }

    try {
      // Б34/§5.2 (TZ 2026-06-16) — source-block guard. Если Goal уже
      // материализована из ЭТОГО блока (ретрай джоба ИЛИ прошлый прогон) — НЕ
      // создаём дубль. Детерминированно по sourceBlockId, не зависит от наличия
      // embedding'а. (Как guard ideas/decisions через `sourceBlockIds: { has }`.)
      const alreadyFromBlock = await this.prisma.goal.findFirst({
        where: {
          tenantId: block.tenantId,
          sourceBlockIds: { has: block.id },
          promotionState: { not: 'dismissed' },
        },
        select: { id: true, promotionState: true },
      });
      if (alreadyFromBlock) {
        // Повтор того же блока: промоутим suggested → active (как handleDuplicate),
        // но НЕ плодим вторую цель.
        if (alreadyFromBlock.promotionState === 'suggested') {
          await this.handleDuplicate({
            tenantId: block.tenantId,
            targetId: alreadyFromBlock.id,
          });
        }
        this.logger.debug(
          { blockId: block.id, goalId: alreadyFromBlock.id },
          'specialist-3-14: цель из этого блока уже есть — skip (source-block guard)',
        );
        return;
      }

      const queryText = `${draft.statement} ${draft.description ?? ''}`;
      const candidates = await this.knnCandidates({
        tenantId: block.tenantId,
        queryText,
      });

      const verdict =
        candidates.length > 0
          ? await this.hierarchyArbiter({
              tenantId: block.tenantId,
              draft,
              candidates,
              dataClass: block.dataClass,
              blockId: block.id,
            })
          : {
              verdict: 'standalone' as const,
              targetId: null,
              parentId: null,
            };

      // ── duplicate: НЕ создаём новую; промоутим existing suggested → active. ──
      if (verdict.verdict === 'duplicate' && verdict.targetId) {
        await this.handleDuplicate({
          tenantId: block.tenantId,
          targetId: verdict.targetId,
        });
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-14-goals',
          action: 'merged',
          message: `Goal-дубликат слит в существующую ${verdict.targetId}`,
          orgId: block.tenantId,
          details: {
            type: 'goal',
            intoId: verdict.targetId,
            blockId: block.id,
          },
        });
        return;
      }

      // ── child_of / standalone: создаём новую цель. ──
      let parentGoalId: string | null = null;
      if (verdict.verdict === 'child_of' && verdict.parentId) {
        // Sanity: parent должен принадлежать candidates и tenant'у.
        const parent = candidates.find((c) => c.id === verdict.parentId);
        if (parent) parentGoalId = parent.id;
      }

      // Cap фокуса по горизонту перед созданием.
      const overCap = await this.isOverFocusCap({
        tenantId: block.tenantId,
        horizon: draft.horizon,
        maxActiveGoalsPerHorizon: thresholds.maxActiveGoalsPerHorizon,
      });
      if (overCap) {
        this.metrics.incCoreSpecialistExtractionFailure({
          type: METRIC_TYPE,
          reason: 'focus_cap',
        });
        this.logger.log(
          { blockId: block.id, horizon: draft.horizon },
          'specialist-3-14: cap фокуса по горизонту достигнут — цель не создаём',
        );
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-14-goals',
          action: 'skipped',
          message: 'Goal не создана: достигнут cap фокуса по горизонту',
          orgId: block.tenantId,
          details: { type: 'goal', reason: 'focus_cap', blockId: block.id },
        });
        return;
      }

      // Owner Org для обязательного createdById.
      const ownerUserId = await this.resolveOwnerUserId(block.tenantId);
      if (!ownerUserId) {
        this.metrics.incCoreSpecialistExtractionFailure({
          type: METRIC_TYPE,
          reason: 'no_owner',
        });
        this.logger.warn(
          { blockId: block.id, tenantId: block.tenantId },
          'specialist-3-14: в Org нет ни одного члена — пропускаю создание цели',
        );
        this.logs.write({
          level: 'WARN',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-14-goals',
          action: 'skipped',
          message: 'Goal не создана: в Org нет ни одного члена (некому быть createdById)',
          orgId: block.tenantId,
          details: { type: 'goal', reason: 'no_owner', blockId: block.id },
        });
        return;
      }

      const promotionState =
        draft.confidence >= thresholds.autoPromoteConfidence
          ? 'active'
          : 'suggested';

      const goal = await this.createGoal({
        tenantId: block.tenantId,
        draft,
        parentGoalId,
        promotionState,
        createdById: ownerUserId,
        sourceBlockIds: [block.id],
      });

      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-14-goals',
        action: 'created',
        message: `создана Goal ${goal.id}`,
        orgId: block.tenantId,
        details: { type: 'goal', entityId: goal.id, blockId: block.id },
      });

      this.metrics.incCoreSpecialistCards({
        type: METRIC_TYPE,
        status: promotionState,
      });

      // Ф5 (TZ 2026-06-16) — фоновый пересчёт Goal.embedding для семантического
      // дедупа следующих целей (specialist-3-14 KNN). Fire-and-forget, как
      // issue-embed: воркер идемпотентен (hash-skip), ошибка не критична для
      // создания цели.
      void this.coreQueue
        ?.enqueueGoalEmbed({ tenantId: block.tenantId, goalId: goal.id })
        .catch((err: unknown) => {
          this.logger.warn(
            {
              goalId: goal.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-14: enqueue goal-embed упал (не критично)',
          );
        });

      // Опц. измеримый KR.
      if (draft.measurable) {
        await this.createKeyResult({
          tenantId: block.tenantId,
          goalId: goal.id,
          measurable: draft.measurable,
          createdById: ownerUserId,
        });
      }

      // Agent-chain overhaul Фаза 4.2 — on-event авто-привязка тем к новой
      // AI-цели (провенанс + co-mention). Best-effort: не критично для создания
      // цели, ошибка только логируется. Без тем strategic-alignment.worker
      // делает ранний return (themesCount===0) → cachedAlignment не считается.
      if (this.goalThemeLinker) {
        try {
          await this.goalThemeLinker.linkGoalThemes(block.tenantId, goal.id);
        } catch (err) {
          this.logger.warn(
            {
              goalId: goal.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'goal-theme-linker on-event: ошибка (не критично)',
          );
        }
      }

      // Agent-chain overhaul Фаза 4.1 — on-event LLM-привязка задач встречи к
      // новой AI-цели (DEFAULT OFF — линкер сам no-op при выключенном флаге).
      // Best-effort: ошибка только логируется. На момент создания цели задач
      // может ещё не быть (триаж позже) — это ок, GoalTaskLinkerCron догонит.
      if (this.goalTaskLinker) {
        try {
          await this.goalTaskLinker.linkGoalTasks(block.tenantId, goal.id);
        } catch (err) {
          this.logger.warn(
            {
              goalId: goal.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'goal-task-linker on-event: ошибка (не критично)',
          );
        }
      }

      this.logger.log(
        {
          blockId: block.id,
          goalId: goal.id,
          verdict: verdict.verdict,
          promotionState,
          parentGoalId,
        },
        'specialist-3-14: цель создана',
      );
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-14.processBlock: ошибка записи — пробрасываю для повтора (BullMQ retry)',
      );
      throw err;
    }
  }

  // ─────────────────────────── extraction ───────────────────────────

  private async extractGoalDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
    minExtractConfidence: number,
  ): Promise<GoalDraft | null> {
    const start = Date.now();
    const quotes = block.evidence
      .slice(0, 6)
      .map((e) => e.quote)
      .filter((q): q is string => !!q && q.length > 0);

    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = GOAL_EXTRACT_USER_TEMPLATE({
      blockName: block.name,
      criticalQuestion: block.criticalQuestion,
      trustedAnswer: block.trustedAnswer,
      signalType: block.signalType,
      tags: block.tags,
      evidenceQuotes: quotes,
    });

    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'goal-extract',
        systemPrompt: guardOn
          ? withInjectionGuard(GOAL_EXTRACT_SYSTEM_PROMPT)
          : GOAL_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: GOAL_EXTRACT_SCHEMA_NAME,
          schema: GOAL_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: block.id },
        dataClass: block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-14.extractGoalDraft: LLM упал — skip',
      );
      return null;
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: RawGoalDraft | null;
    try {
      parsed = JSON.parse(result.text) as RawGoalDraft;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'json_parse',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
          textSample: result.text.slice(0, 300),
        },
        'specialist-3-14.extractGoalDraft: JSON.parse упал — skip',
      );
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.statement) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'schema_validation',
      });
      return null;
    }
    // «Не цель» — анти-плодёж.
    if (parsed.isGoal === false) {
      this.logger.debug(
        { blockId: block.id },
        'specialist-3-14.extractGoalDraft: блок не является целью — skip',
      );
      return null;
    }
    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    if (confidence < minExtractConfidence) {
      this.logger.debug(
        { blockId: block.id, confidence },
        'specialist-3-14.extractGoalDraft: confidence слишком низкий — skip',
      );
      return null;
    }

    return {
      statement: parsed.statement.trim(),
      description:
        typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : null,
      horizon: this.normalizeHorizon(parsed.horizon),
      measurable: this.normalizeMeasurable(parsed.measurable),
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  }

  private normalizeHorizon(input: unknown): GoalHorizon {
    if (typeof input === 'string' && VALID_HORIZONS.has(input)) {
      return input as GoalHorizon;
    }
    return 'quarterly';
  }

  private normalizeMeasurable(input: unknown): GoalMeasurable | null {
    if (!input || typeof input !== 'object') return null;
    const m = input as {
      name?: unknown;
      unit?: unknown;
      startValue?: unknown;
      targetValue?: unknown;
    };
    if (typeof m.name !== 'string' || !m.name.trim()) return null;
    const startValue = typeof m.startValue === 'number' ? m.startValue : 0;
    const targetValue = typeof m.targetValue === 'number' ? m.targetValue : null;
    if (targetValue === null) return null;
    return {
      name: m.name.trim().slice(0, 300),
      unit:
        typeof m.unit === 'string' && m.unit.trim()
          ? m.unit.trim().slice(0, 100)
          : null,
      startValue,
      targetValue,
    };
  }

  // ─────────────────────────── KNN-кандидаты ───────────────────────────

  /**
   * Ближайшие существующие цели для дедупа/иерархии.
   *
   * Ф5 (TZ 2026-06-16) — семантический KNN по `Goal.embedding` (pgvector cosine,
   * HNSW-индекс `goal_embedding_hnsw_cosine_idx`) вместо прежнего ILIKE по 2
   * словам. Паттерн идентичен specialist-3-3-decisions: синхронный embed
   * запроса → pgvector ORDER BY `embedding <=> qvec` по тому же tenant. При
   * промахе embedding'а (null/таймаут/пустой индекс) — best-effort fallback на
   * прежний ILIKE по первым словам (не падаем). Свежие цели без вектора
   * (воркер ещё не отработал) ловятся ILIKE-fallback'ом и source-block guard'ом.
   *
   * Фильтр: tenantId, promotionState != 'dismissed', validUntil IS NULL.
   */
  private async knnCandidates(args: {
    tenantId: string;
    queryText: string;
  }): Promise<GoalKnnCandidate[]> {
    const queryText = args.queryText.trim().slice(0, 2_000);
    if (!queryText) return [];

    // 1. Семантический путь — embed запроса + pgvector KNN.
    let embedding: number[] | null;
    try {
      embedding = await this.embedder.embedQuery(queryText);
    } catch {
      embedding = null;
    }

    if (embedding && embedding.length > 0) {
      try {
        const vec = `[${embedding.join(',')}]`;
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{
            id: string;
            name: string;
            description: string | null;
            horizon: GoalHorizon;
            promotionState: string;
          }>
        >(
          `SELECT "id", "name", "description", "horizon", "promotionState"
             FROM "Goal"
            WHERE "tenantId" = $1
              AND "embedding" IS NOT NULL
              AND "promotionState" <> 'dismissed'
              AND "validUntil" IS NULL
            ORDER BY "embedding" <=> $2::vector
            LIMIT ${Specialist314GoalsService.KNN_TOP_K}`,
          args.tenantId,
          vec,
        );
        if (rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description ?? null,
            horizon: r.horizon,
            promotionState: r.promotionState,
          }));
        }
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-14.knnCandidates: pgvector KNN упал — fallback на ILIKE',
        );
      }
    }

    // 2. Fallback — ILIKE по первым словам (best-effort, если вектора ещё нет).
    const firstWords = queryText
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 2)
      .join(' ');
    if (!firstWords) return [];

    const rows = await this.prisma.goal.findMany({
      where: {
        tenantId: args.tenantId,
        promotionState: { not: 'dismissed' },
        validUntil: null,
        OR: [
          { name: { contains: firstWords, mode: 'insensitive' } },
          { description: { contains: firstWords, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        horizon: true,
        promotionState: true,
      },
      take: Specialist314GoalsService.KNN_TOP_K,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      horizon: r.horizon,
      promotionState: r.promotionState,
    }));
  }

  // ─────────────────────────── hierarchy-арбитр ───────────────────────────

  private async hierarchyArbiter(args: {
    tenantId: string;
    draft: GoalDraft;
    candidates: GoalKnnCandidate[];
    dataClass: DataClass;
    blockId: string;
  }): Promise<HierarchyVerdict> {
    const standalone: HierarchyVerdict = {
      verdict: 'standalone',
      targetId: null,
      parentId: null,
      confidence: null,
      reasoning: null,
    };

    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = GOAL_HIERARCHY_LINK_USER_TEMPLATE({
      draftStatement: args.draft.statement,
      draftHorizon: args.draft.horizon,
      candidates: args.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        horizon: c.horizon,
        description: c.description,
      })),
    });

    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'goal-hierarchy-link',
        systemPrompt: guardOn
          ? withInjectionGuard(GOAL_HIERARCHY_LINK_SYSTEM_PROMPT)
          : GOAL_HIERARCHY_LINK_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: GOAL_HIERARCHY_LINK_SCHEMA_NAME,
          schema: GOAL_HIERARCHY_LINK_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: args.blockId },
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'arbiter_skip',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-14.hierarchyArbiter: LLM упал — fallback к standalone',
      );
      return standalone;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: RawHierarchyVerdict;
    try {
      parsed = JSON.parse(result.text) as RawHierarchyVerdict;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'arbiter_json_parse',
      });
      return standalone;
    }

    const candidateIds = new Set(args.candidates.map((c) => c.id));
    const confidence = parsed.confidence ?? null;
    const reasoning = parsed.reasoning ?? null;
    if (parsed.verdict === 'duplicate') {
      if (parsed.targetId && candidateIds.has(parsed.targetId)) {
        return {
          verdict: 'duplicate',
          targetId: parsed.targetId,
          parentId: null,
          confidence,
          reasoning,
        };
      }
      return standalone;
    }
    if (parsed.verdict === 'child_of') {
      if (parsed.parentId && candidateIds.has(parsed.parentId)) {
        return {
          verdict: 'child_of',
          targetId: null,
          parentId: parsed.parentId,
          confidence,
          reasoning,
        };
      }
      return standalone;
    }
    return {
      verdict: 'standalone',
      targetId: null,
      parentId: null,
      confidence,
      reasoning,
    };
  }

  async suggestParentForGoal(args: {
    tenantId: string;
    goalId: string;
  }): Promise<{
    suggestedParentGoalId: string | null;
    verdict: 'duplicate' | 'child_of' | 'standalone';
    candidates: Array<{ goalId: string; name: string }>;
    reasoning: string | null;
    confidence: number | null;
  }> {
    const goal = await this.prisma.goal.findFirst({
      where: { id: args.goalId, tenantId: args.tenantId },
      select: { id: true, name: true, description: true, horizon: true },
    });
    if (!goal) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    const exclude = await this.collectGoalAndDescendants(
      args.tenantId,
      args.goalId,
    );
    const queryText = `${goal.name} ${goal.description ?? ''}`.trim();
    const candidates = (
      await this.knnCandidates({ tenantId: args.tenantId, queryText })
    ).filter((c) => !exclude.has(c.id));
    if (candidates.length === 0) {
      return {
        suggestedParentGoalId: null,
        verdict: 'standalone',
        candidates: [],
        reasoning: 'Похожих целей не найдено — цель выглядит самостоятельной.',
        confidence: null,
      };
    }
    const verdict = await this.hierarchyArbiter({
      tenantId: args.tenantId,
      draft: {
        statement: goal.name,
        description: goal.description,
        horizon: goal.horizon,
        measurable: null,
        confidence: 1,
      },
      candidates,
      dataClass: 'internal' as DataClass,
      blockId: goal.id,
    });
    return {
      suggestedParentGoalId:
        verdict.verdict === 'child_of' ? verdict.parentId : null,
      verdict: verdict.verdict,
      candidates: candidates.map((c) => ({ goalId: c.id, name: c.name })),
      reasoning: verdict.reasoning,
      confidence: verdict.confidence,
    };
  }

  private async collectGoalAndDescendants(
    tenantId: string,
    goalId: string,
  ): Promise<Set<string>> {
    const result = new Set<string>([goalId]);
    let frontier = [goalId];
    let depth = 0;
    while (frontier.length > 0 && depth < 50) {
      const children = await this.prisma.goal.findMany({
        where: { tenantId, parentGoalId: { in: frontier } },
        select: { id: true },
      });
      const next = children.map((c) => c.id).filter((id) => !result.has(id));
      if (next.length === 0) break;
      next.forEach((id) => result.add(id));
      frontier = next;
      depth += 1;
    }
    return result;
  }

  // ─────────────────────────── apply verdict ───────────────────────────

  /**
   * duplicate — новую цель НЕ создаём. Повторное упоминание: если existing цель
   * в состоянии 'suggested' → промоутим её в 'active' (метрика dedup).
   */
  private async handleDuplicate(args: {
    tenantId: string;
    targetId: string;
  }): Promise<void> {
    const existing = await this.prisma.goal.findFirst({
      where: { id: args.targetId, tenantId: args.tenantId },
      select: { id: true, promotionState: true },
    });
    if (!existing) return;
    if (existing.promotionState === 'suggested') {
      await this.prisma.goal.update({
        where: { id: existing.id },
        data: { promotionState: 'active' },
      });
      this.logger.log(
        { goalId: existing.id },
        'specialist-3-14: дубликат-повтор — existing цель промоутнута suggested→active',
      );
    }
    this.metrics.incCoreSpecialistExtractionFailure({
      type: METRIC_TYPE,
      reason: 'dedup',
    });
  }

  private async isOverFocusCap(args: {
    tenantId: string;
    horizon: GoalHorizon;
    maxActiveGoalsPerHorizon: number;
  }): Promise<boolean> {
    const count = await this.prisma.goal.count({
      where: {
        tenantId: args.tenantId,
        horizon: args.horizon,
        validUntil: null,
        promotionState: { in: ['active', 'suggested'] },
      },
    });
    return count >= args.maxActiveGoalsPerHorizon;
  }

  private async createGoal(args: {
    tenantId: string;
    draft: GoalDraft;
    parentGoalId: string | null;
    promotionState: 'suggested' | 'active';
    createdById: string;
    sourceBlockIds: string[];
  }): Promise<Goal> {
    const progressStatus: GoalProgressStatus = 'on_track';
    return this.prisma.goal.create({
      data: {
        tenantId: args.tenantId,
        name: args.draft.statement.slice(0, 1_000),
        description: args.draft.description ?? args.draft.statement,
        horizon: args.draft.horizon,
        parentGoalId: args.parentGoalId,
        source: 'ai',
        promotionState: args.promotionState,
        progressStatus,
        sourceBlockIds: args.sourceBlockIds,
        confidence: new Prisma.Decimal(
          Math.max(0, Math.min(1, args.draft.confidence)),
        ),
        recordedAt: new Date(),
        createdById: args.createdById,
      },
    });
  }

  private async createKeyResult(args: {
    tenantId: string;
    goalId: string;
    measurable: GoalMeasurable;
    createdById: string;
  }): Promise<void> {
    try {
      await this.prisma.goalKeyResult.create({
        data: {
          tenantId: args.tenantId,
          goalId: args.goalId,
          name: args.measurable.name,
          unit: args.measurable.unit,
          startValue: new Prisma.Decimal(args.measurable.startValue),
          targetValue: new Prisma.Decimal(args.measurable.targetValue),
          currentValue: new Prisma.Decimal(args.measurable.startValue),
          // Авто-прогресс KR — Фаза 3. Пока sourceKind='manual'.
          sourceKind: 'manual',
          source: 'ai',
          createdById: args.createdById,
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          goalId: args.goalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-14.createKeyResult: упал — цель создана без KR',
      );
    }
  }

  // ─────────────────────────── owner resolver ───────────────────────────

  private async resolveOwnerUserId(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    if (owner?.userId) return owner.userId;

    const anyMember = await this.prisma.membership.findFirst({
      where: { orgId: tenantId },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    return anyMember?.userId ?? null;
  }
}

// ─────────────────────────── shared types ───────────────────────────

interface GoalThresholds {
  minExtractConfidence: number;
  autoPromoteConfidence: number;
  maxActiveGoalsPerHorizon: number;
}

interface RawGoalDraft {
  isGoal?: boolean;
  statement?: string;
  description?: string | null;
  horizon?: string;
  measurable?: unknown;
  confidence?: number;
}

export interface GoalMeasurable {
  name: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
}

export interface GoalDraft {
  statement: string;
  description: string | null;
  horizon: GoalHorizon;
  measurable: GoalMeasurable | null;
  confidence: number;
}

interface GoalKnnCandidate {
  id: string;
  name: string;
  description: string | null;
  horizon: GoalHorizon;
  promotionState: string;
}

interface RawHierarchyVerdict {
  verdict: 'duplicate' | 'child_of' | 'standalone';
  targetId?: string | null;
  parentId?: string | null;
  confidence?: number;
  reasoning?: string | null;
}

interface HierarchyVerdict {
  verdict: 'duplicate' | 'child_of' | 'standalone';
  targetId: string | null;
  parentId: string | null;
  confidence: number | null;
  reasoning: string | null;
}
