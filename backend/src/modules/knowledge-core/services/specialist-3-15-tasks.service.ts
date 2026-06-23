import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type IdeaBlock,
  type IdeaBlockEvidence,
  Prisma,
  type SourceType,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { SystemLogPipeline } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';
import { ProbeService } from '../../probe/probe.service';
import { AssigneeResolverService } from '../../tracker/services/assignee-resolver.service';
import { IntakeAutoTriageQueueService } from '../../tracker/services/intake-auto-triage-queue.service';
import {
  TASK_EXTRACT_JSON_SCHEMA,
  TASK_EXTRACT_SCHEMA_NAME,
  TASK_EXTRACT_SYSTEM_PROMPT,
  TASK_EXTRACT_USER_TEMPLATE,
} from '../prompts/task-extract.prompt';

const METRIC_TYPE = 'task';

const INTAKE_TTL_DAYS_FALLBACK = 14;

const DUE_HINT_RE = /^\d{4}-\d{2}-\d{2}$/;

const CHANNEL_SOURCE_MAP: Partial<Record<SourceType, string>> = {
  chatbox: 'chatbox',
  chat: 'chatbox',
  conversational: 'telegram',
  external: 'api',
  web_form: 'api',
  bot: 'api',
  daily_checkin: 'checkin',
};

@Injectable()
export class Specialist315TasksService {
  private readonly logger = new Logger(Specialist315TasksService.name);

  static readonly SPECIALIST_NAME = '3-15-tasks';
  static readonly MIN_EXTRACT_CONFIDENCE = 0.45;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LogService) private readonly logs: LogService,
    @Inject(AssigneeResolverService)
    private readonly assigneeResolver: AssigneeResolverService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
    @Optional()
    @Inject(ProbeService)
    private readonly probe?: ProbeService,
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
      include: { evidence: { orderBy: { sourceTimestamp: { sort: 'asc', nulls: 'last' } } } },
    });
    if (!block) return;
    if (block.tenantId !== args.tenantId) return;

    const isMeetingDerived = block.evidence.some(
      (e) => e.sourceType === 'meeting' || e.sourceType === 'meeting_report',
    );
    if (isMeetingDerived) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: Specialist315TasksService.SPECIALIST_NAME,
        reason: 'meeting_handled_elsewhere',
      });
      this.logger.debug(
        { blockId: block.id },
        'specialist-3-15: блок встречи — задачи извлекает meeting-extract-actions, skip',
      );
      return;
    }

    const channel = block.evidence[0]?.sourceType ?? null;

    const draft = await this.extractTaskDraft(block);
    if (!draft) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: Specialist315TasksService.SPECIALIST_NAME,
        reason: 'no_draft',
      });
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-15-tasks',
        action: 'skipped',
        message: 'Задача не извлечена (не задача / низкий confidence)',
        orgId: block.tenantId,
        details: { type: METRIC_TYPE, reason: 'no_draft', blockId: block.id },
      });
      return;
    }

    const alreadyFromBlock = await this.prisma.intakeIssue.findFirst({
      where: { tenantId: block.tenantId, sourceBlockIds: { has: block.id } },
      select: { id: true },
    });
    if (alreadyFromBlock) {
      this.logger.debug(
        { blockId: block.id, intakeIssueId: alreadyFromBlock.id },
        'specialist-3-15: задача из этого блока уже есть — skip (source-block guard)',
      );
      return;
    }

    let suggestedAssigneeId: string | null = null;
    if (draft.assigneeHint) {
      const r = await this.assigneeResolver.resolve(
        block.tenantId,
        draft.assigneeHint,
      );
      if (r.kind === 'resolved') suggestedAssigneeId = r.userId;
    }

    const source = (channel && CHANNEL_SOURCE_MAP[channel]) || 'api';
    const ttlDays =
      this.cfg?.pendingActions.intakeTtlDays ?? INTAKE_TTL_DAYS_FALLBACK;
    const dueDate =
      draft.dueHint && DUE_HINT_RE.test(draft.dueHint)
        ? new Date(`${draft.dueHint}T00:00:00.000Z`)
        : null;

    let issue: { id: string };
    try {
      issue = await this.prisma.intakeIssue.create({
        data: {
          tenantId: block.tenantId,
          projectId: null,
          status: 'pending',
          source,
          externalSource: channel ?? 'api',
          externalId: block.id,
          rawContent: block.trustedAnswer ?? block.name,
          extractedTitle: draft.title,
          extractedDescription: draft.sourceQuote || null,
          suggestedProjectId: null,
          suggestedAssigneeId,
          suggestedGoalId: null,
          suggestedPriority: draft.priorityHint || null,
          suggestedDueDate: dueDate,
          suggestedLabels: [],
          sourceBlockIds: [block.id],
          meetingId: null,
          confidence: new Prisma.Decimal(draft.confidence),
          expiresAt: computeExpiresAt(ttlDays),
        },
        select: { id: true },
      });
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
        'specialist-3-15.processBlock: ошибка записи — пробрасываю для повтора (BullMQ retry)',
      );
      throw err;
    }

    this.metrics.incCoreSpecialistCards({ type: METRIC_TYPE, status: 'pending' });
    this.logs.write({
      level: 'INFO',
      pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
      module: 'specialist-3-15-tasks',
      action: 'created',
      message: `создан IntakeIssue ${issue.id}`,
      orgId: block.tenantId,
      details: {
        type: METRIC_TYPE,
        entityId: issue.id,
        blockId: block.id,
        source,
      },
    });

    if (
      suggestedAssigneeId == null &&
      this.cfg?.tracker.assigneeClarifyEnabled &&
      this.probe
    ) {
      try {
        const recipient = await this.resolveProbeRecipient(block.tenantId);
        if (recipient) {
          await this.probe.suggest({
            tenantId: block.tenantId,
            emittedByService: 'specialist-3-15-tasks',
            reason: 'task.assignee_unresolved',
            payload: {
              contextCardId: issue.id,
              contextCardKind: 'intake_issue',
              contextCardTitle: draft.title,
              objectName: draft.title,
              objectKindRu: 'задача',
              message: `Из ${channel ?? 'внешнего'}-сообщения извлечена задача «${draft.title}», но не определён исполнитель.`,
              suggestedQuestion: `Кому поручить задачу «${draft.title}»?`,
            },
            recipientCandidates: [recipient],
            priorityHint: this.cfg.tracker.assigneeProbePriorityHint,
          });
        }
      } catch {
        // best-effort
      }
    }

    try {
      await this.autoTriageQueue?.enqueue({
        tenantId: block.tenantId,
        intakeIssueId: issue.id,
      });
    } catch (err) {
      this.logger.warn(
        {
          intakeIssueId: issue.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-15: enqueue auto-triage упал — продолжаем',
      );
    }
  }

  private async extractTaskDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
  ): Promise<TaskDraft | null> {
    const start = Date.now();
    const quotes = block.evidence
      .slice(0, 6)
      .map((e) => e.quote)
      .filter((q): q is string => !!q && q.length > 0);

    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = TASK_EXTRACT_USER_TEMPLATE({
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
        taskType: 'task-extract',
        systemPrompt: guardOn
          ? withInjectionGuard(TASK_EXTRACT_SYSTEM_PROMPT)
          : TASK_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: TASK_EXTRACT_SCHEMA_NAME,
          schema: TASK_EXTRACT_JSON_SCHEMA,
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
        'specialist-3-15.extractTaskDraft: LLM упал — skip',
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

    let parsed: RawTaskDraft | null;
    try {
      parsed = JSON.parse(result.text) as RawTaskDraft;
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
        'specialist-3-15.extractTaskDraft: JSON.parse упал — skip',
      );
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.title) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: METRIC_TYPE,
        reason: 'schema_validation',
      });
      return null;
    }
    if (parsed.isTask === false) {
      this.logger.debug(
        { blockId: block.id },
        'specialist-3-15.extractTaskDraft: блок не является задачей — skip',
      );
      return null;
    }
    const minConfidence =
      (await this.cfg?.getDynamic<number>(
        'tracker.taskExtractMinConfidence',
        undefined,
        Specialist315TasksService.MIN_EXTRACT_CONFIDENCE,
      )) ?? Specialist315TasksService.MIN_EXTRACT_CONFIDENCE;
    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    if (confidence < minConfidence) {
      this.logger.debug(
        { blockId: block.id, confidence },
        'specialist-3-15.extractTaskDraft: confidence слишком низкий — skip',
      );
      return null;
    }

    return {
      title: parsed.title.trim(),
      sourceQuote:
        typeof parsed.sourceQuote === 'string' ? parsed.sourceQuote.trim() : '',
      assigneeHint:
        typeof parsed.assigneeHint === 'string' ? parsed.assigneeHint.trim() : '',
      dueHint: typeof parsed.dueHint === 'string' ? parsed.dueHint.trim() : '',
      priorityHint: this.normalizePriority(parsed.priorityHint),
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  }

  private normalizePriority(input: unknown): string {
    if (input === 'low' || input === 'medium' || input === 'high') return input;
    return '';
  }

  private async resolveProbeRecipient(tenantId: string): Promise<string | null> {
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

interface RawTaskDraft {
  isTask?: boolean;
  title?: string;
  sourceQuote?: string;
  assigneeHint?: string;
  dueHint?: string;
  priorityHint?: string;
  confidence?: number;
}

export interface TaskDraft {
  title: string;
  sourceQuote: string;
  assigneeHint: string;
  dueHint: string;
  priorityHint: string;
  confidence: number;
}
