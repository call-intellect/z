import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
 *   - У Goal НЕТ embedding-колонки → KNN через ILIKE-fallback (как у decisions
 *     при отсутствии вектора).
 *   - Goal.createdById обязателен (FK на User onDelete:Restrict) — подставляем
 *     owner'а Org (Membership role='owner'). Нет owner → skip создания.
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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

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
      where: { id: args.blockId },
      include: { evidence: true },
    });
    if (!block) return;
    if (block.tenantId !== args.tenantId) return;

    const draft = await this.extractGoalDraft(block);
    if (!draft) return;

    try {
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
        return;
      }

      // Owner Org для обязательного createdById.
      const ownerUserId = await this.resolveOwnerUserId(block.tenantId);
      if (!ownerUserId) {
        this.logger.warn(
          { blockId: block.id, tenantId: block.tenantId },
          'specialist-3-14: не найден owner Org — пропускаю создание цели',
        );
        return;
      }

      const promotionState =
        draft.confidence >= Specialist314GoalsService.AUTO_PROMOTE_CONFIDENCE
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

      this.metrics.incCoreSpecialistCards({
        type: METRIC_TYPE,
        status: promotionState,
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
        'specialist-3-14.processBlock: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  // ─────────────────────────── extraction ───────────────────────────

  private async extractGoalDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
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
    if (confidence < Specialist314GoalsService.MIN_EXTRACT_CONFIDENCE) {
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
   * Ближайшие существующие цели для дедупа/иерархии. У Goal НЕТ embedding-колонки
   * (проверено в schema.prisma), поэтому используем ILIKE-fallback по name/description
   * (паттерн fallback из specialist-3-3-decisions). embedQuery дёргаем лишь для
   * единообразия будущего апгрейда — результат не используется без вектор-колонки.
   *
   * Фильтр: tenantId, promotionState != 'dismissed', validUntil IS NULL.
   */
  private async knnCandidates(args: {
    tenantId: string;
    queryText: string;
  }): Promise<GoalKnnCandidate[]> {
    const queryText = args.queryText.trim().slice(0, 2_000);
    if (!queryText) return [];

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
    if (parsed.verdict === 'duplicate') {
      if (parsed.targetId && candidateIds.has(parsed.targetId)) {
        return { verdict: 'duplicate', targetId: parsed.targetId, parentId: null };
      }
      return standalone;
    }
    if (parsed.verdict === 'child_of') {
      if (parsed.parentId && candidateIds.has(parsed.parentId)) {
        return { verdict: 'child_of', targetId: null, parentId: parsed.parentId };
      }
      return standalone;
    }
    return standalone;
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
  }): Promise<boolean> {
    const count = await this.prisma.goal.count({
      where: {
        tenantId: args.tenantId,
        horizon: args.horizon,
        validUntil: null,
        promotionState: { in: ['active', 'suggested'] },
      },
    });
    return count >= Specialist314GoalsService.MAX_ACTIVE_GOALS_PER_HORIZON;
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

  /**
   * Goal.createdById обязателен (FK на User, onDelete:Restrict). У AI-специалиста
   * нет реального пользователя — подставляем owner'а Org (Membership role='owner').
   * Нет owner → null (caller пропускает создание, не падает).
   */
  private async resolveOwnerUserId(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }
}

// ─────────────────────────── shared types ───────────────────────────

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
}
