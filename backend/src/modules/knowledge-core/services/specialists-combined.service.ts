import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type DataClass,
  type DecisionStatus,
  type IdeaKind,
  type InsightKind,
  type InsightSeverity,
  Prisma,
  type SkillConfidence,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { CurationService } from '../../curation/services/curation.service';
import { DashboardQueueService } from '../../dashboard/services/dashboard-queue.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import {
  TaskDraftMaterializerService,
  type TaskDraftInput,
} from '../../tracker/services/task-draft-materializer.service';
import {
  buildSpecialistsCombinedSystemPrompt,
  buildSpecialistsCombinedUserMessage,
  type CombinedChannelKind,
  type CombinedInputBlock,
  type SpecialistsCombinedOutput,
  SPECIALISTS_COMBINED_MAX_TOKENS,
  SPECIALISTS_COMBINED_TASK_TYPE,
  SPECIALISTS_COMBINED_TOOL_NAME,
  SpecialistsCombinedOutputSchema,
  SUBMIT_ALL_ENTITIES_TOOL,
} from '../prompts/specialists-combined.prompt';

import { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

export interface SpecialistsCombinedExtractArgs {
  tenantId: string;
  meetingId: string;
  meetingTitle?: string;
  blocks: CombinedInputBlock[];
  jobId?: string;
  dataClass?: DataClass;
  channelKind?: CombinedChannelKind;
  sourceType?: string;
}

export interface SpecialistsCombinedExtractResult {
  created: {
    decisions: number;
    ideas: number;
    insights: number;
    experiments: number;
    regulations: number;
    instructions: number;
    knowledgeCategories: number;
    skillTraits: number;
    helpfulnessTraits: number;
    tasks: number;
  };
  emptySections: string[];
  llm: {
    modelUsed: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  };
  errors: string[];
}

export class SpecialistsCombinedParseError extends Error {
  constructor(
    message: string,
    readonly rawText?: string,
  ) {
    super(message);
    this.name = 'SpecialistsCombinedParseError';
  }
}

@Injectable()
export class SpecialistsCombinedService {
  private readonly logger = new Logger(SpecialistsCombinedService.name);

  static readonly METRIC_TYPE = 'combined';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(CurationService)
    private readonly curation?: CurationService,
    @Optional()
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder?: KnowledgeEmbeddingService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
    @Optional()
    @Inject(CoreQueueService)
    private readonly coreQueue?: CoreQueueService,
    @Optional()
    @Inject(DashboardQueueService)
    private readonly dashboardQueue?: DashboardQueueService,
    @Optional()
    @Inject(EntityResolutionService)
    private readonly entities?: EntityResolutionService,
    @Optional()
    @Inject(TaskDraftMaterializerService)
    private readonly taskMaterializer?: TaskDraftMaterializerService,
  ) {}

  async extractAll(
    args: SpecialistsCombinedExtractArgs,
  ): Promise<SpecialistsCombinedExtractResult> {
    this.logger.log(
      {
        tenantId: args.tenantId,
        sourceType: args.sourceType ?? 'meeting',
        externalId: args.meetingId,
        channelKind: args.channelKind ?? 'meeting',
        blocks: args.blocks.length,
      },
      '[PIPE] combo START',
    );

    if (args.blocks.length === 0) {
      this.logger.log(
        { meetingId: args.meetingId, tenantId: args.tenantId },
        'specialists-combined: пустой список блоков — skip',
      );
      return this.emptyResult({
        modelUsed: 'noop',
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
      });
    }

    const channelKind: CombinedChannelKind = args.channelKind ?? 'meeting';
    const systemPrompt = buildSpecialistsCombinedSystemPrompt(channelKind);
    const userMessage = buildSpecialistsCombinedUserMessage({
      meetingTitle: args.meetingTitle ?? `meeting:${args.meetingId}`,
      blocks: args.blocks,
      channelKind,
    });

    const startedAt = Date.now();
    const result = await this.llm.call({
      taskType: SPECIALISTS_COMBINED_TASK_TYPE,
      systemPrompt,
      userMessage,
      tenantId: args.tenantId,
      ...(channelKind === 'meeting' ? { meetingId: args.meetingId } : {}),
      ...(args.jobId ? { jobId: args.jobId } : {}),
      maxTokens: SPECIALISTS_COMBINED_MAX_TOKENS,
      tools: [SUBMIT_ALL_ENTITIES_TOOL],
      sourceRef: { type: args.sourceType ?? 'meeting', id: args.meetingId },
      dataClass: args.dataClass ?? 'internal',
    });

    let parsed: SpecialistsCombinedOutput;
    try {
      parsed = this.parseToolCallOutput(result.toolCalls, result.text);
    } catch (parseErr) {
      if (!(parseErr instanceof SpecialistsCombinedParseError)) throw parseErr;
      parsed = await this.repairJsonAndRetry({
        systemPrompt,
        userMessage,
        invalidRawText: parseErr.rawText ?? result.text,
        parseError: parseErr.message,
        tenantId: args.tenantId,
        meetingId: args.meetingId,
        channelKind,
        dataClass: args.dataClass ?? 'internal',
        sourceType: args.sourceType ?? 'meeting',
        ...(args.jobId ? { jobId: args.jobId } : {}),
      });
    }

    const errors: string[] = [];
    const created = {
      decisions: 0,
      ideas: 0,
      insights: 0,
      experiments: 0,
      regulations: 0,
      instructions: 0,
      knowledgeCategories: 0,
      skillTraits: 0,
      helpfulnessTraits: 0,
      tasks: 0,
    };

    const blockIdSet = new Set(args.blocks.map((b) => b.id));
    const dataClass: DataClass = args.dataClass ?? 'internal';

    const decisionIds: string[] = [];
    const knowledgePersonIds = new Set<string>();
    const skillProfileIds = new Set<string>();

    created.decisions = await this.persistDecisions(
      args.tenantId,
      parsed,
      blockIdSet,
      errors,
      dataClass,
      decisionIds,
    );
    created.ideas = await this.persistIdeas(
      args.tenantId,
      parsed,
      blockIdSet,
      errors,
      dataClass,
    );
    created.insights = await this.persistInsights(args.tenantId, parsed, blockIdSet, errors);
    created.experiments = await this.persistExperiments(args.tenantId, parsed, blockIdSet, errors);
    created.regulations = await this.persistRegulations(args.tenantId, parsed, blockIdSet, errors);
    created.instructions = await this.persistInstructions(
      args.tenantId,
      parsed,
      blockIdSet,
      errors,
    );
    created.knowledgeCategories = await this.persistKnowledgeCategories(
      args.tenantId,
      parsed,
      knowledgePersonIds,
    );
    created.skillTraits = await this.persistSkillTraits(
      args.tenantId,
      parsed,
      errors,
      knowledgePersonIds,
      skillProfileIds,
    );
    created.helpfulnessTraits = await this.persistHelpfulness(
      args.tenantId,
      parsed,
      blockIdSet,
      errors,
    );
    created.tasks = await this.persistTasks(
      args.tenantId,
      parsed,
      blockIdSet,
      args.sourceType ?? 'meeting',
      args.meetingId,
      args.meetingTitle ?? null,
    );

    await this.enqueueSideEffects({
      tenantId: args.tenantId,
      sourceLabel: `${args.sourceType ?? 'meeting'}:${args.meetingId}`,
      decisionIds,
      knowledgePersonIds,
      skillProfileIds,
    });

    this.recordMetrics(created, result);

    const emptySections: string[] = [];
    if (parsed.decisions.length === 0) emptySections.push('decisions');
    if (parsed.ideas.length === 0) emptySections.push('ideas');
    if (parsed.insights.length === 0) emptySections.push('insights');
    if (parsed.experiments.length === 0) emptySections.push('experiments');
    if (parsed.regulations.length === 0) emptySections.push('regulations');
    if (parsed.knowledge_categories.length === 0) emptySections.push('knowledge_categories');
    if (parsed.skill_traits.length === 0) emptySections.push('skill_traits');
    if (parsed.helpfulness_traits.length === 0) emptySections.push('helpfulness_traits');
    if (parsed.tasks.length === 0) emptySections.push('tasks');

    this.logger.log(
      {
        tenantId: args.tenantId,
        externalId: args.meetingId,
        tasks: created.tasks,
        decisions: created.decisions,
        ideas: created.ideas,
        insights: created.insights,
        experiments: created.experiments,
        regulations: created.regulations,
        instructions: created.instructions,
        knowledgeCategories: created.knowledgeCategories,
        skillTraits: created.skillTraits,
        helpfulnessTraits: created.helpfulnessTraits,
      },
      '[PIPE] combo DONE',
    );

    return {
      created,
      emptySections,
      llm: {
        modelUsed: result.modelUsed,
        durationMs: Date.now() - startedAt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens,
      },
      errors,
    };
  }

  private parseToolCallOutput(
    toolCalls: Array<{ name: string; input: unknown }> | undefined,
    fallbackText: string,
  ): SpecialistsCombinedOutput {
    let rawInput: unknown = null;

    if (toolCalls && toolCalls.length > 0) {
      const direct = toolCalls.find((tc) => tc.name === SPECIALISTS_COMBINED_TOOL_NAME);
      rawInput = (direct ?? toolCalls[0])?.input ?? null;
    }

    if (rawInput === null && fallbackText) {
      try {
        rawInput = JSON.parse(fallbackText);
      } catch {}
    }

    if (rawInput === null) {
      throw new SpecialistsCombinedParseError(
        `LLM не вернул tool_calls (${SPECIALISTS_COMBINED_TOOL_NAME}) и не вернул валидный JSON в text`,
        fallbackText,
      );
    }

    if (typeof rawInput === 'string') {
      try {
        rawInput = JSON.parse(rawInput);
      } catch (err) {
        throw new SpecialistsCombinedParseError(
          `LLM вернул tool_call с невалидным JSON в arguments: ${
            err instanceof Error ? err.message : String(err)
          }`,
          fallbackText,
        );
      }
    }

    const validated = SpecialistsCombinedOutputSchema.safeParse(rawInput);
    if (!validated.success) {
      throw new SpecialistsCombinedParseError(
        `LLM-output не прошёл zod-валидацию: ${validated.error.message}`,
        fallbackText,
      );
    }
    return validated.data;
  }

  private async repairJsonAndRetry(args: {
    systemPrompt: string;
    userMessage: string;
    invalidRawText: string;
    parseError: string;
    tenantId: string;
    meetingId: string;
    channelKind: CombinedChannelKind;
    dataClass: DataClass;
    sourceType: string;
    jobId?: string;
  }): Promise<SpecialistsCombinedOutput> {
    const timeoutMs = this.cfg
      ? await this.cfg.getDynamic<number>(
          'knowledge.specialistsCombinedRepairTimeoutMs',
          undefined,
          60_000,
        )
      : 60_000;

    const repairUserMessage = [
      'Твой предыдущий ответ невалиден (не распарсился по схеме инструмента).',
      'Вот он:',
      args.invalidRawText.slice(0, 12_000),
      '',
      `Ошибка: ${args.parseError}`,
      '',
      `Верни ВАЛИДНЫЙ JSON строго по схеме инструмента ${SPECIALISTS_COMBINED_TOOL_NAME}, без пояснений.`,
      '',
      'Исходные данные для извлечения:',
      args.userMessage,
    ].join('\n');

    this.logger.warn(
      {
        tenantId: args.tenantId,
        externalId: args.meetingId,
        sourceType: args.sourceType,
        parseError: args.parseError,
      },
      'specialists-combined: первый ответ не распарсился — repair-retry',
    );

    const repaired = await this.llm.call({
      taskType: SPECIALISTS_COMBINED_TASK_TYPE,
      systemPrompt: args.systemPrompt,
      userMessage: repairUserMessage,
      tenantId: args.tenantId,
      ...(args.channelKind === 'meeting' ? { meetingId: args.meetingId } : {}),
      ...(args.jobId ? { jobId: args.jobId } : {}),
      maxTokens: SPECIALISTS_COMBINED_MAX_TOKENS,
      tools: [SUBMIT_ALL_ENTITIES_TOOL],
      sourceRef: { type: args.sourceType, id: args.meetingId },
      dataClass: args.dataClass,
      timeoutMs,
    });

    return this.parseToolCallOutput(repaired.toolCalls, repaired.text);
  }

  private async persistDecisions(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
    dataClass: DataClass,
    decisionIds: string[],
  ): Promise<number> {
    let created = 0;
    for (const d of parsed.decisions) {
      if (!blockIdSet.has(d.sourceBlockId)) {
        this.logger.debug(
          { sourceBlockId: d.sourceBlockId },
          'specialists-combined.decisions: sourceBlockId не найден в наборе блоков встречи — skip',
        );
        continue;
      }
      // Б50 (K4) — детерминированный source-block дедуп. Combined-путь может
      // запускаться параллельно со старыми специалистами (см. шапку файла) или
      // ретраиться BullMQ → голый create плодил бы дубли. Guard по
      // sourceBlockIds:{has} перед create (как в single-специалистах).
      const dupDecision = await this.prisma.decision.findFirst({
        where: { tenantId, deletedAt: null, sourceBlockIds: { has: d.sourceBlockId } },
        select: { id: true },
      });
      if (dupDecision) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'decision',
          reason: 'source_block_dedup',
        });
        continue;
      }
      const status = (d.status ?? 'approved') as DecisionStatus;
      const confidence = new Prisma.Decimal(this.clamp01(d.confidence));
      const alternatives =
        d.alternatives && d.alternatives.length > 0
          ? (d.alternatives as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      try {
        const existing = await this.prisma.decision.findUnique({
          where: { sourceIdeaBlockId: d.sourceBlockId },
          select: { id: true, sourceBlockIds: true },
        });
        const decision = await this.prisma.decision.upsert({
          where: { sourceIdeaBlockId: d.sourceBlockId },
          create: {
            tenantId,
            text: d.statement.slice(0, 1_000),
            statement: d.statement,
            rationale: d.rationale ?? null,
            alternatives,
            sourceBlockIds: [d.sourceBlockId],
            sourceIdeaBlockId: d.sourceBlockId,
            status,
            confidence,
          },
          update: {
            statement: d.statement,
            rationale: d.rationale ?? undefined,
            alternatives,
            sourceBlockIds: {
              set: this.union(existing?.sourceBlockIds ?? [], [d.sourceBlockId]),
            },
            status,
            confidence,
            lastConfirmedAt: new Date(),
          },
          select: { id: true },
        });
        if (!existing) created += 1;
        decisionIds.push(decision.id);
        await this.applyDecisionSideEffects({
          tenantId,
          decisionId: decision.id,
          statement: d.statement,
          rationale: d.rationale ?? null,
          alternatives: d.alternatives ?? [],
          status,
          sourceBlockId: d.sourceBlockId,
          confidence: this.clamp01(d.confidence),
          dataClass,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          this.isSourceIdeaBlockUniqueViolation(err)
        ) {
          this.metrics?.incCoreSpecialistExtractionFailure({
            type: 'decision',
            reason: 'db_conflict',
          });
          this.logger.debug(
            { sourceBlockId: d.sourceBlockId },
            'specialists-combined.decisions: P2002 sourceIdeaBlockId — решение уже создано другим писателем, дедуп',
          );
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`decision[${d.sourceBlockId}]: ${msg}`);
        this.logger.warn(
          { sourceBlockId: d.sourceBlockId, err: msg },
          'specialists-combined.decisions: persist упал — продолжаем',
        );
      }
    }
    return created;
  }

  private async persistIdeas(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
    dataClass: DataClass,
  ): Promise<number> {
    let created = 0;
    for (const i of parsed.ideas) {
      if (!blockIdSet.has(i.sourceBlockId)) continue;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupIdea = await this.prisma.idea.findFirst({
        where: { tenantId, sourceBlockIds: { has: i.sourceBlockId } },
        select: { id: true },
      });
      if (dupIdea) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'idea',
          reason: 'source_block_dedup',
        });
        continue;
      }
      const weight = this.computeIdeaWeight({
        supporterCount: 1,
        recencyDate: new Date(),
        hasRationale: Boolean(i.rationale),
      });
      try {
        const idea = await this.prisma.idea.create({
          data: {
            tenantId,
            kind: i.kind as IdeaKind,
            statement: i.statement,
            rationale: i.rationale ?? null,
            sourceBlockIds: [i.sourceBlockId],
            weight: new Prisma.Decimal(weight),
            confidence: new Prisma.Decimal(this.clamp01(i.confidence)),
            supporters: [] as unknown as Prisma.InputJsonValue,
            supporterCount: 1,
            status: 'captured',
          },
          select: { id: true },
        });
        created += 1;
        await this.applyIdeaSideEffects({
          tenantId,
          ideaId: idea.id,
          kind: i.kind,
          statement: i.statement,
          rationale: i.rationale ?? null,
          sourceBlockId: i.sourceBlockId,
          weight,
          confidence: this.clamp01(i.confidence),
          dataClass,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`idea[${i.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  private async applyDecisionSideEffects(args: {
    tenantId: string;
    decisionId: string;
    statement: string;
    rationale: string | null;
    alternatives: ReadonlyArray<unknown>;
    status: DecisionStatus;
    sourceBlockId: string;
    confidence: number;
    dataClass: DataClass;
  }): Promise<void> {
    await this.tryWriteEmbedding({
      table: 'decisions',
      id: args.decisionId,
      text: `${args.statement} ${args.rationale ?? ''}`,
    });
    try {
      await this.curation?.triage({
        tenantId: args.tenantId,
        resourceType: 'decision',
        resourceId: args.decisionId,
        confidence: this.clamp01(args.confidence),
        proposedPayload: {
          statement: args.statement,
          rationale: args.rationale,
          alternatives: args.alternatives,
          status: args.status,
          sourceBlockIds: [args.sourceBlockId],
        },
        conflictSignal: 'none',
        createdByUserId: null,
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.logger.debug(
        {
          decisionId: args.decisionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialists-combined.decisions: triage упал — карточка без CurationItem (best-effort)',
      );
    }
  }

  private async applyIdeaSideEffects(args: {
    tenantId: string;
    ideaId: string;
    kind: string;
    statement: string;
    rationale: string | null;
    sourceBlockId: string;
    weight: number;
    confidence: number;
    dataClass: DataClass;
  }): Promise<void> {
    await this.tryWriteEmbedding({
      table: 'ideas',
      id: args.ideaId,
      text: args.statement,
    });
    try {
      await this.curation?.triage({
        tenantId: args.tenantId,
        resourceType: 'idea',
        resourceId: args.ideaId,
        confidence: this.clamp01(args.confidence),
        proposedPayload: {
          kind: args.kind,
          statement: args.statement,
          rationale: args.rationale,
          weight: args.weight,
          sourceBlockIds: [args.sourceBlockId],
        },
        conflictSignal: 'none',
        createdByUserId: null,
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.logger.debug(
        {
          ideaId: args.ideaId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialists-combined.ideas: triage упал — карточка без CurationItem (best-effort)',
      );
    }
    try {
      this.events?.emit('idea.created', {
        tenantId: args.tenantId,
        ideaId: args.ideaId,
        kind: args.kind,
      });
    } catch {
      // graceful
    }
  }

  private computeIdeaWeight(args: {
    supporterCount: number;
    recencyDate: Date;
    hasRationale: boolean;
  }): number {
    const days = Math.max(
      0,
      (Date.now() - args.recencyDate.getTime()) / (1000 * 86400),
    );
    const recencyFactor = Math.max(0.1, 1 - days / 60);
    const specificityFactor = args.hasRationale ? 1 : 0.5;
    const base = Math.max(1, args.supporterCount) * 1.0;
    const value = base + recencyFactor * 0.5 + specificityFactor;
    return Math.round(value * 1000) / 1000;
  }

  private async tryWriteEmbedding(args: {
    table: 'decisions' | 'ideas';
    id: string;
    text: string;
  }): Promise<void> {
    if (!this.embedder) return;
    try {
      const text = args.text.trim().slice(0, 2_000);
      if (!text) return;
      const vec = await this.embedder.embedQuery(text);
      if (!vec) return;
      const vecStr = `[${vec.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE "${args.table}" SET "embedding" = $1::vector WHERE "id" = $2`,
        vecStr,
        args.id,
      );
    } catch (err) {
      this.logger.debug(
        {
          table: args.table,
          id: args.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialists-combined.tryWriteEmbedding: пропускаю (best-effort)',
      );
    }
  }

  private async persistInsights(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const it of parsed.insights) {
      if (!blockIdSet.has(it.sourceBlockId)) continue;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupInsight = await this.prisma.insight.findFirst({
        where: { tenantId, sourceBlockIds: { has: it.sourceBlockId } },
        select: { id: true },
      });
      if (dupInsight) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'insight',
          reason: 'source_block_dedup',
        });
        continue;
      }
      try {
        await this.prisma.insight.create({
          data: {
            tenantId,
            kind: it.kind as InsightKind,
            statement: it.statement,
            severity: it.severity as InsightSeverity,
            sourceBlockIds: [it.sourceBlockId],
            mitigationPlan: it.mitigationSuggestion ?? null,
            causeCategory: it.causeCategory,
            confidence: new Prisma.Decimal(this.clamp01(it.confidence)),
            firstObservedAt: new Date(),
            lastObservedAt: new Date(),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`insight[${it.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  private async persistExperiments(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const e of parsed.experiments) {
      if (!blockIdSet.has(e.sourceBlockId)) continue;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupExperiment = await this.prisma.experiment.findFirst({
        where: { tenantId, sourceBlockIds: { has: e.sourceBlockId } },
        select: { id: true },
      });
      if (dupExperiment) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'experiment',
          reason: 'source_block_dedup',
        });
        continue;
      }
      try {
        await this.prisma.experiment.create({
          data: {
            tenantId,
            name: e.name.slice(0, 120),
            hypothesisText: e.hypothesisText,
            status: e.status,
            currentResult: e.currentResult ?? null,
            lessonsJson:
              e.lessons && e.lessons.length > 0
                ? (e.lessons as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            sourceBlockIds: [e.sourceBlockId],
            confidence: new Prisma.Decimal(this.clamp01(e.confidence)),
            lastConfirmedAt: new Date(),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`experiment[${e.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  private async persistRegulations(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const r of parsed.regulations) {
      if (!blockIdSet.has(r.sourceBlockId)) continue;
      if (r.kind === 'instruction') continue;
      let gateStrict: boolean;
      try {
        gateStrict = this.cfg?.aiFeatures.regulationGateStrict !== false;
      } catch {
        gateStrict = true;
      }
      const isDeclaredNeed = r.extractionStatus === 'нужен' || r.extractionStatus === 'обсуждается';
      if (gateStrict && r.isOrgNorm === false && !isDeclaredNeed) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'regulation',
          reason: 'not_a_norm',
        });
        continue;
      }
      const scope = await this.resolveScope(tenantId, r.scope);
      const hintOwner = await this.resolveOwnerPersonHint(tenantId, r.ownerHint);
      const author = await this.resolveBlockAuthor(tenantId, r.sourceBlockId);
      try {
        const existingReg = await this.prisma.regulation.findUnique({
          where: { tenantId_name: { tenantId, name: r.name } },
          select: { sourceBlockIds: true, personSubjectIds: true, ownerPersonId: true },
        });
        const ownerOnUpdate =
          hintOwner ??
          (existingReg && existingReg.ownerPersonId == null
            ? author?.personId ?? undefined
            : undefined);
        const subjectUnion = author?.entityId
          ? this.union(existingReg?.personSubjectIds ?? [], [author.entityId])
          : null;
        await this.prisma.regulation.upsert({
          where: {
            tenantId_name: { tenantId, name: r.name },
          },
          update: {
            statement: r.statement,
            sourceBlockIds: {
              set: this.union(existingReg?.sourceBlockIds ?? [], [
                r.sourceBlockId,
              ]),
            },
            confidence: r.confidence,
            category: r.kind === 'standard' ? 'standard' : 'regulation',
            scope,
            ...(ownerOnUpdate ? { ownerPersonId: ownerOnUpdate } : {}),
            ...(subjectUnion ? { personSubjectIds: { set: subjectUnion } } : {}),
          },
          create: {
            tenantId,
            name: r.name,
            contentMd: r.statement,
            statement: r.statement,
            category: r.kind === 'standard' ? 'standard' : 'regulation',
            confidence: r.confidence,
            sourceBlockIds: [r.sourceBlockId],
            scope,
            ownerPersonId: hintOwner ?? author?.personId ?? null,
            ...(author?.entityId ? { personSubjectIds: [author.entityId] } : {}),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`regulation[${r.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  private async persistInstructions(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const r of parsed.regulations) {
      if (r.kind !== 'instruction') continue;
      if (!blockIdSet.has(r.sourceBlockId)) continue;
      const forRole =
        r.roles
          ?.find((x) => x && x.trim().length > 0)
          ?.trim()
          .slice(0, 120) ?? null;
      const status: 'active' | 'deprecated' =
        r.extractionStatus === 'нужен' || r.extractionStatus === 'обсуждается'
          ? 'deprecated'
          : 'active';
      const scope = await this.resolveScope(
        tenantId,
        r.scope ?? (forRole ? `role:${forRole}` : null),
      );
      const hintOwner = await this.resolveOwnerPersonHint(tenantId, r.ownerHint);
      const author = await this.resolveBlockAuthor(tenantId, r.sourceBlockId);
      try {
        const existingInstr = await this.prisma.instruction.findUnique({
          where: { tenantId_name: { tenantId, name: r.name } },
          select: { sourceBlockIds: true, personSubjectIds: true, ownerPersonId: true },
        });
        const ownerOnUpdate =
          hintOwner ??
          (existingInstr && existingInstr.ownerPersonId == null
            ? author?.personId ?? undefined
            : undefined);
        const subjectUnion = author?.entityId
          ? this.union(existingInstr?.personSubjectIds ?? [], [author.entityId])
          : null;
        await this.prisma.instruction.upsert({
          where: { tenantId_name: { tenantId, name: r.name } },
          update: {
            statement: r.statement,
            contentMd: r.statement,
            sourceBlockIds: {
              set: this.union(existingInstr?.sourceBlockIds ?? [], [
                r.sourceBlockId,
              ]),
            },
            confidence: r.confidence,
            forRole: forRole ?? undefined,
            status,
            scope,
            ...(ownerOnUpdate ? { ownerPersonId: ownerOnUpdate } : {}),
            ...(subjectUnion ? { personSubjectIds: { set: subjectUnion } } : {}),
          },
          create: {
            tenantId,
            name: r.name,
            contentMd: r.statement,
            statement: r.statement,
            confidence: r.confidence,
            forRole,
            status,
            sourceBlockIds: [r.sourceBlockId],
            scope,
            ownerPersonId: hintOwner ?? author?.personId ?? null,
            ...(author?.entityId ? { personSubjectIds: [author.entityId] } : {}),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`instruction[${r.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  private async persistKnowledgeCategories(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    knowledgePersonIds: Set<string>,
  ): Promise<number> {
    if (parsed.knowledge_categories.length === 0) return 0;

    const names = Array.from(
      new Set(parsed.knowledge_categories.map((c) => c.personName.trim())),
    ).filter((n) => n.length > 0);
    if (names.length === 0) return 0;

    const persons = await this.prisma.person.findMany({
      where: { tenantId, name: { in: names }, deletedAt: null },
      select: { id: true, name: true },
    });
    const personIdByName = new Map<string, string>();
    for (const p of persons) personIdByName.set(p.name, p.id);

    let created = 0;
    for (const c of parsed.knowledge_categories) {
      const personId = personIdByName.get(c.personName.trim());
      if (!personId) {
        this.logger.debug(
          { personName: c.personName },
          'specialists-combined.knowledge_categories: Person не найден — skip',
        );
        continue;
      }
      knowledgePersonIds.add(personId);
      created += 1;
    }
    return created;
  }

  private async persistSkillTraits(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    errors: string[],
    knowledgePersonIds: Set<string>,
    skillProfileIds: Set<string>,
  ): Promise<number> {
    if (parsed.skill_traits.length === 0) return 0;

    const names = Array.from(new Set(parsed.skill_traits.map((s) => s.personName.trim()))).filter(
      (n) => n.length > 0,
    );
    if (names.length === 0) return 0;

    const persons = await this.prisma.person.findMany({
      where: { tenantId, name: { in: names }, deletedAt: null },
      select: { id: true, name: true },
    });
    const personIdByName = new Map<string, string>();
    for (const p of persons) personIdByName.set(p.name, p.id);

    let created = 0;
    for (const s of parsed.skill_traits) {
      const personId = personIdByName.get(s.personName.trim());
      if (!personId) continue;
      try {
        const profile = await this.ensureSkillProfile(tenantId, personId);
        knowledgePersonIds.add(personId);
        skillProfileIds.add(profile.id);
        await this.prisma.skillTrait.create({
          data: {
            profileId: profile.id,
            category: s.category.slice(0, 200),
            statement: s.statement.slice(0, 2_000),
            confidence: s.confidence as SkillConfidence,
            observationCount: Math.max(1, s.sourceBlockIds?.length ?? 1),
            sourceBlockIds: (s.sourceBlockIds ?? []).slice(0, 50),
            firstObservedAt: new Date(),
            lastConfirmedAt: new Date(),
            status: 'active',
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`skill_trait[${s.personName}/${s.category}]: ${msg}`);
      }
    }
    return created;
  }

  private async ensureSkillProfile(tenantId: string, personId: string): Promise<{ id: string }> {
    const existing = await this.prisma.skillProfile.findUnique({
      where: { personId },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.skillProfile.create({
      data: { tenantId, personId, status: 'active' },
      select: { id: true },
    });
  }

  private async persistHelpfulness(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    if (parsed.helpfulness_traits.length === 0) return 0;

    const hints = new Set<string>();
    for (const h of parsed.helpfulness_traits) {
      hints.add(h.helperUserHint.trim());
      if (h.recipientUserHint) hints.add(h.recipientUserHint.trim());
    }
    const hintList = [...hints].filter((n) => n.length > 0);
    if (hintList.length === 0) return 0;

    const persons = await this.prisma.person.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ name: { in: hintList } }, { email: { in: hintList } }],
        userId: { not: null },
      },
      select: { name: true, email: true, userId: true },
    });
    const userByHint = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) {
        userByHint.set(p.name, p.userId);
        if (p.email) userByHint.set(p.email, p.userId);
      }
    }

    let created = 0;
    for (const h of parsed.helpfulness_traits) {
      if (!blockIdSet.has(h.sourceBlockId)) continue;
      const helperUserId = userByHint.get(h.helperUserHint.trim());
      if (!helperUserId) continue;
      const recipientUserId = h.recipientUserHint
        ? (userByHint.get(h.recipientUserHint.trim()) ?? null)
        : null;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupHelpfulness = await this.prisma.helpfulnessTrait.findFirst({
        where: { tenantId, sourceBlockIds: { has: h.sourceBlockId } },
        select: { id: true },
      });
      if (dupHelpfulness) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'helpfulness',
          reason: 'source_block_dedup',
        });
        continue;
      }
      try {
        await this.prisma.helpfulnessTrait.create({
          data: {
            tenantId,
            helperUserId,
            recipientUserId,
            traitType: h.traitType,
            intensity: new Prisma.Decimal(this.clamp01(h.intensity)),
            topicHint: h.topicHint.slice(0, 200),
            sourceBlockIds: [h.sourceBlockId],
            evidenceQuote: h.evidenceQuote,
            confidence: new Prisma.Decimal(this.clamp01(h.confidence)),
            visibility: 'internal',
            lastObservedAt: new Date(),
            status: 'active',
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`helpfulness[${h.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  private async persistTasks(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    channel: string,
    sourceId: string,
    sourceTitle: string | null,
  ): Promise<number> {
    if (!this.taskMaterializer) return 0;
    const drafts: TaskDraftInput[] = parsed.tasks
      .filter((t) => blockIdSet.has(t.sourceBlockId))
      .map((t) => ({
        title: t.title,
        assignee: t.assignee ?? null,
        dueDate: t.dueDate ?? null,
        suggestedAssigneeHint: t.suggestedAssigneeHint ?? null,
        suggestedDueDate: t.suggestedDueDate ?? null,
        suggestedPriority: t.suggestedPriority ?? null,
        confidence: typeof t.confidence === 'number' ? t.confidence : null,
        sourceQuote: t.sourceQuote ?? null,
        subtasks: t.subtasks ?? null,
        sourceBlockId: t.sourceBlockId,
      }));
    if (drafts.length === 0) return 0;
    try {
      const created = await this.taskMaterializer.materialize({
        tenantId,
        channel,
        sourceId,
        sourceTitle,
        drafts,
      });
      return created.length;
    } catch (err) {
      this.logger.warn(
        { channel, sourceId, err: err instanceof Error ? err.message : String(err) },
        'specialists-combined.persistTasks: материализация задач упала (best-effort)',
      );
      return 0;
    }
  }

  private async enqueueSideEffects(args: {
    tenantId: string;
    sourceLabel: string;
    decisionIds: string[];
    knowledgePersonIds: Set<string>;
    skillProfileIds: Set<string>;
  }): Promise<void> {
    const reason = `combined:${args.sourceLabel}`;
    for (const personId of args.knowledgePersonIds) {
      try {
        await this.coreQueue?.enqueueRebuildKnowledgeProfile({
          tenantId: args.tenantId,
          personId,
          reason,
        });
      } catch (err) {
        this.logger.warn(
          { personId, err: err instanceof Error ? err.message : String(err) },
          'specialists-combined: enqueueRebuildKnowledgeProfile упал — пропускаю Person',
        );
      }
    }
    for (const profileId of args.skillProfileIds) {
      try {
        await this.coreQueue?.enqueueRebuildSkillProfile({
          tenantId: args.tenantId,
          profileId,
          reason,
        });
      } catch (err) {
        this.logger.warn(
          { profileId, err: err instanceof Error ? err.message : String(err) },
          'specialists-combined: enqueueRebuildSkillProfile упал — пропускаю профиль',
        );
      }
    }
    for (const decisionId of args.decisionIds) {
      try {
        await this.dashboardQueue?.enqueueDecisionHygiene({
          tenantId: args.tenantId,
          decisionId,
        });
      } catch (err) {
        this.logger.warn(
          { decisionId, err: err instanceof Error ? err.message : String(err) },
          'specialists-combined: enqueueDecisionHygiene упал — пропускаю решение',
        );
      }
    }
  }

  private async resolveScope(
    tenantId: string,
    rawScope: string | null | undefined,
  ): Promise<string | null> {
    const raw = rawScope?.trim() ?? null;
    if (!raw || !raw.startsWith('role:')) return raw ? raw.slice(0, 120) : null;
    const hint = raw.slice('role:'.length).trim();
    if (!hint) return raw.slice(0, 120);
    const existing = await this.prisma.role.findFirst({
      where: { id: hint, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (existing) return `role:${existing.id}`;
    const resolved = await this.entities?.resolveRoleByHint(tenantId, hint);
    if (resolved) return `role:${resolved}`;
    this.metrics?.incRegulationScopeUnresolved?.({ tenantTop: tenantTopOf(tenantId) });
    return raw.slice(0, 120);
  }

  private async resolveOwnerPersonHint(
    tenantId: string,
    hint: string | null | undefined,
  ): Promise<string | null> {
    if (!hint) return null;
    const trimmed = hint.trim();
    if (trimmed.length < 2) return null;
    const personId = await this.entities?.resolvePersonByHint(tenantId, trimmed);
    if (!personId)
      this.metrics?.incRegulationOwnerUnresolved?.({ tenantTop: tenantTopOf(tenantId) });
    return personId ?? null;
  }

  private async resolveBlockAuthor(
    tenantId: string,
    sourceBlockId: string,
  ): Promise<{ personId: string; entityId: string | null } | null> {
    try {
      const ev = await this.prisma.ideaBlockEvidence.findFirst({
        where: { blockId: sourceBlockId, tenantId, authorPersonId: { not: null } },
        orderBy: { sourceTimestamp: { sort: 'asc', nulls: 'last' } },
        select: { authorPersonId: true },
      });
      const authorPersonId = ev?.authorPersonId ?? null;
      if (!authorPersonId) return null;
      const person = await this.prisma.person.findFirst({
        where: { id: authorPersonId, tenantId, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (!person) return null;
      return { personId: person.id, entityId: person.entityId ?? null };
    } catch {
      return null;
    }
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private isSourceIdeaBlockUniqueViolation(
    err: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = err.meta?.['target'];
    if (Array.isArray(target)) return target.includes('sourceIdeaBlockId');
    return typeof target === 'string' && target.includes('sourceIdeaBlockId');
  }

  /**
   * Б57 (K4) — объединение массивов с дедупом (эталон —
   * specialist-3-3-decisions.service.ts `union`). Combined-путь обновляет
   * провенанс regulation/instruction через upsert; `{ push }` без дедупа
   * накапливал бы дубли sourceBlockId при повторной встрече того же имени.
   */
  private union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
  }

  private emptyResult(
    llm: SpecialistsCombinedExtractResult['llm'],
  ): SpecialistsCombinedExtractResult {
    return {
      created: {
        decisions: 0,
        ideas: 0,
        insights: 0,
        experiments: 0,
        regulations: 0,
        instructions: 0,
        knowledgeCategories: 0,
        skillTraits: 0,
        helpfulnessTraits: 0,
        tasks: 0,
      },
      emptySections: [
        'decisions',
        'ideas',
        'insights',
        'experiments',
        'regulations',
        'knowledge_categories',
        'skill_traits',
        'helpfulness_traits',
        'tasks',
      ],
      llm,
      errors: [],
    };
  }

  private recordMetrics(
    created: SpecialistsCombinedExtractResult['created'],
    llm: { modelUsed: string; tier?: string | null; inputTokens: number; outputTokens: number },
  ): void {
    if (!this.metrics) return;
    const type = SpecialistsCombinedService.METRIC_TYPE;
    const tier = llm.tier ?? 'unknown';

    const total =
      created.decisions +
      created.ideas +
      created.insights +
      created.experiments +
      created.regulations +
      created.instructions +
      created.knowledgeCategories +
      created.skillTraits +
      created.helpfulnessTraits +
      created.tasks;
    for (let i = 0; i < total; i++) {
      this.metrics.incCoreSpecialistCards({ type, status: 'canonical' });
    }

    if (llm.inputTokens > 0) {
      this.metrics.incCoreSpecialistLlmTokens({
        type,
        model: llm.modelUsed,
        tier,
        tokens: llm.inputTokens,
      });
    }
    if (llm.outputTokens > 0) {
      this.metrics.incCoreSpecialistLlmTokens({
        type,
        model: llm.modelUsed,
        tier,
        tokens: llm.outputTokens,
      });
    }
  }
}
