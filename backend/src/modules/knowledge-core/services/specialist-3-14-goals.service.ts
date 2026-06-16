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
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
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

const METRIC_TYPE = 'goal';

const VALID_HORIZONS: ReadonlySet<string> = new Set([
  'strategic',
  'annual',
  'quarterly',
  'monthly',
  'sprint',
]);

@Injectable()
export class Specialist314GoalsService {
  private readonly logger = new Logger(Specialist314GoalsService.name);

  static readonly SPECIALIST_NAME = '3-14-goals';
  private static readonly KNN_TOP_K = 5;
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;
  private static readonly AUTO_PROMOTE_CONFIDENCE = 0.8;
  private static readonly MAX_ACTIVE_GOALS_PER_HORIZON = 7;

  @Optional()
  @Inject(GoalThemeLinkerService)
  private readonly goalThemeLinker?: GoalThemeLinkerService;

  @Optional()
  @Inject(GoalTaskLinkerService)
  private readonly goalTaskLinker?: GoalTaskLinkerService;

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

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async processBlock(args: { tenantId: string; blockId: string }): Promise<void> {
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: args.blockId },
      include: { evidence: true },
    });
    if (!block) return;
    if (block.tenantId !== args.tenantId) return;

    const draft = await this.extractGoalDraft(block);
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

      let parentGoalId: string | null = null;
      if (verdict.verdict === 'child_of' && verdict.parentId) {
        const parent = candidates.find((c) => c.id === verdict.parentId);
        if (parent) parentGoalId = parent.id;
      }

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

      const ownerUserId = await this.resolveOwnerUserId(block.tenantId);
      if (!ownerUserId) {
        this.logger.warn(
          { blockId: block.id, tenantId: block.tenantId },
          'specialist-3-14: не найден owner Org — пропускаю создание цели',
        );
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-14-goals',
          action: 'skipped',
          message: 'Goal не создана: не найден owner Org',
          orgId: block.tenantId,
          details: { type: 'goal', reason: 'no_owner', blockId: block.id },
        });
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

      if (draft.measurable) {
        await this.createKeyResult({
          tenantId: block.tenantId,
          goalId: goal.id,
          measurable: draft.measurable,
          createdById: ownerUserId,
        });
      }

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
        'specialist-3-14.processBlock: внутренняя ошибка — пропускаю блок',
      );
    }
  }

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
    if (parsed.isGoal === false) {
      this.logger.debug(
        { blockId: block.id },
        'specialist-3-14.extractGoalDraft: блок не является целью — skip',
      );
      return null;
    }
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
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
      unit: typeof m.unit === 'string' && m.unit.trim() ? m.unit.trim().slice(0, 100) : null,
      startValue,
      targetValue,
    };
  }

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

  private async handleDuplicate(args: { tenantId: string; targetId: string }): Promise<void> {
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

  private async isOverFocusCap(args: { tenantId: string; horizon: GoalHorizon }): Promise<boolean> {
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
        confidence: new Prisma.Decimal(Math.max(0, Math.min(1, args.draft.confidence))),
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

  private async resolveOwnerUserId(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }
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
}
