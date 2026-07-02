import { createHash } from 'node:crypto';

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
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { SystemLogPipeline } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';
import { ProbeService } from '../../probe/probe.service';
import { AssigneeResolverService } from '../../tracker/services/assignee-resolver.service';
import { IntakeAutoTriageQueueService } from '../../tracker/services/intake-auto-triage-queue.service';
import { IntakeIssueSimilarService } from '../../tracker/services/intake-issue-similar.service';
import { TaskDedupService } from '../../tracker/services/task-dedup.service';
import {
  TASK_EXTRACT_JSON_SCHEMA,
  TASK_EXTRACT_SCHEMA_NAME,
  TASK_EXTRACT_SYSTEM_PROMPT,
  TASK_EXTRACT_USER_TEMPLATE,
} from '../prompts/task-extract.prompt';
import { normalizeTaskTitle } from '../util/task-dedup-matcher.util';

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
    @Optional()
    @Inject(TaskDedupService)
    private readonly taskDedup?: TaskDedupService,
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
    @Optional()
    @Inject(IntakeIssueSimilarService)
    private readonly intakeSimilar?: IntakeIssueSimilarService,
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
      where: { id_tenantId: { id: args.blockId, tenantId: args.tenantId } },
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

    const linkSemantics =
      (await this.cfg?.getDynamic<'link' | 'delete'>(
        'tracker.taskDedupLinkSemantics',
        undefined,
        'link',
      )) ?? 'link';
    const normTitle = normalizeTaskTitle(draft.title);

    let matchedIssueId: string | null = null;
    if (linkSemantics === 'link' && this.taskDedup) {
      try {
        const d = await this.taskDedup.evaluate({
          tenantId: block.tenantId,
          title: draft.title,
          description: draft.sourceQuote || null,
        });
        if (d.verdict === 'same' && d.matchedIssueId) {
          matchedIssueId = d.matchedIssueId;
        }
      } catch {
        // best-effort: сбой дедупа не должен блокировать извлечение
      }
    }

    const dedupText = buildIntakeDedupText(draft.title, draft.sourceQuote);
    let dedupVecLiteral: string | null = null;
    let dedupHash: string | null = null;
    if (
      linkSemantics === 'link' &&
      this.embeddings &&
      this.intakeSimilar &&
      dedupText.length > 0
    ) {
      try {
        const vectors = await this.embeddings.embed([dedupText]);
        const vec = vectors[0];
        if (vec && vec.length > 0) {
          dedupVecLiteral = `[${vec.join(',')}]`;
          dedupHash = sha256Hex(dedupText);
        }
      } catch (err) {
        this.logger.debug(
          {
            blockId: block.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-15: KNN-эмбеддинг не построен — деградация до exact-дедупа',
        );
      }
    }
    const dedupThreshold = this.cfg
      ? await this.cfg.getDynamic<number>('tracker.intakeDedupThreshold', undefined, 0.15)
      : 0.15;

    let created: CreateOutcome;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${block.tenantId + ':' + normTitle}))`;
        if (linkSemantics === 'link') {
          if (!matchedIssueId) {
            const exact = await tx.issue.findFirst({
              where: {
                tenantId: block.tenantId,
                title: { equals: draft.title, mode: 'insensitive' },
                completedAt: null,
                deletedAt: null,
              },
              select: { id: true },
            });
            if (exact) matchedIssueId = exact.id;
          }
          if (matchedIssueId) {
            await tx.taskSource
              .create({
                data: {
                  tenantId: block.tenantId,
                  issueId: matchedIssueId,
                  sourceType: channel ?? 'api',
                  sourceRefId: block.id,
                  quote: draft.sourceQuote || null,
                },
              })
              .catch((e) => {
                if ((e as { code?: string })?.code !== 'P2002') throw e;
              });
            return { kind: 'linked', issueId: matchedIssueId };
          }
          const pendingDup = await tx.intakeIssue.findFirst({
            where: {
              tenantId: block.tenantId,
              status: 'pending',
              extractedTitle: { equals: draft.title, mode: 'insensitive' },
            },
            select: { id: true },
          });
          if (pendingDup) {
            return { kind: 'dedup_pending', intakeIssueId: pendingDup.id };
          }
          if (dedupVecLiteral && this.intakeSimilar) {
            const similar = await this.intakeSimilar.findSimilarByVector({
              tenantId: block.tenantId,
              embedding: dedupVecLiteral,
              threshold: dedupThreshold,
            });
            if (similar.length > 0) {
              return {
                kind: 'dedup_pending_semantic',
                intakeIssueId: similar[0]!.intakeIssueId,
                distance: similar[0]!.distance,
              };
            }
          }
        }
        const issue = await tx.intakeIssue.create({
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
        if (dedupVecLiteral && dedupHash) {
          await tx.$executeRawUnsafe(
            'UPDATE "IntakeIssue" SET embedding = $1::vector(1536), "embeddingHash" = $2 WHERE id = $3 AND "tenantId" = $4',
            dedupVecLiteral,
            dedupHash,
            issue.id,
            block.tenantId,
          );
        }
        return { kind: 'created', intakeIssueId: issue.id };
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

    if (created.kind === 'linked') {
      this.metrics.incCoreSpecialistSkipped({
        specialist: Specialist315TasksService.SPECIALIST_NAME,
        reason: 'linked_existing_issue',
      });
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-15-tasks',
        action: 'linked',
        message: `задача из блока связана с открытым Issue ${created.issueId}`,
        orgId: block.tenantId,
        details: {
          type: METRIC_TYPE,
          entityId: created.issueId,
          blockId: block.id,
          source,
        },
      });
      return;
    }

    if (created.kind === 'dedup_pending') {
      this.metrics.incCoreSpecialistSkipped({
        specialist: Specialist315TasksService.SPECIALIST_NAME,
        reason: 'dedup_pending_intake',
      });
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-15-tasks',
        action: 'skipped',
        message: `дубль с pending IntakeIssue ${created.intakeIssueId} — skip`,
        orgId: block.tenantId,
        details: {
          type: METRIC_TYPE,
          entityId: created.intakeIssueId,
          blockId: block.id,
          source,
        },
      });
      return;
    }

    if (created.kind === 'dedup_pending_semantic') {
      this.metrics.incCoreSpecialistSkipped({
        specialist: Specialist315TasksService.SPECIALIST_NAME,
        reason: 'dedup_pending_intake_semantic',
      });
      this.logger.debug(
        {
          blockId: block.id,
          intakeIssueId: created.intakeIssueId,
          distance: created.distance,
        },
        'specialist-3-15: семантический дубль pending IntakeIssue (KNN) — skip',
      );
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-15-tasks',
        action: 'skipped',
        message: `семантический дубль pending IntakeIssue ${created.intakeIssueId} (KNN) — skip`,
        orgId: block.tenantId,
        details: {
          type: METRIC_TYPE,
          entityId: created.intakeIssueId,
          blockId: block.id,
          source,
        },
      });
      return;
    }

    const intakeIssueId = created.intakeIssueId;
    this.metrics.incCoreSpecialistCards({ type: METRIC_TYPE, status: 'pending' });
    this.logs.write({
      level: 'INFO',
      pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
      module: 'specialist-3-15-tasks',
      action: 'created',
      message: `создан IntakeIssue ${intakeIssueId}`,
      orgId: block.tenantId,
      details: {
        type: METRIC_TYPE,
        entityId: intakeIssueId,
        blockId: block.id,
        source,
      },
    });

    if (this.probe && (suggestedAssigneeId == null || dueDate == null)) {
      try {
        const recipient = await this.resolveSetterRecipient(block, draft);
        if (recipient) {
          if (suggestedAssigneeId == null && this.cfg?.tracker.assigneeClarifyEnabled) {
            await this.probe.suggest({
              tenantId: block.tenantId,
              emittedByService: 'specialist-3-15-tasks',
              reason: 'task.assignee_unresolved',
              payload: {
                contextCardId: intakeIssueId,
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
          } else if (dueDate == null && this.cfg?.tracker.dueDateClarifyEnabled) {
            await this.probe.suggest({
              tenantId: block.tenantId,
              emittedByService: 'specialist-3-15-tasks',
              reason: 'task.due_date_missing',
              payload: {
                contextCardId: intakeIssueId,
                contextCardKind: 'intake_issue',
                contextCardTitle: draft.title,
                objectName: draft.title,
                objectKindRu: 'задача',
                message: `Из ${channel ?? 'внешнего'}-сообщения извлечена задача «${draft.title}», но не указан срок.`,
                suggestedQuestion: `К какому сроку нужно сделать «${draft.title}»?`,
                sourceOccurredAtIso: block.evidence[0]?.sourceTimestamp?.toISOString(),
              },
              recipientCandidates: [recipient],
              priorityHint: this.cfg.tracker.assigneeProbePriorityHint,
            });
          }
        }
      } catch {
        // best-effort
      }
    }

    try {
      await this.autoTriageQueue?.enqueue({
        tenantId: block.tenantId,
        intakeIssueId,
      });
    } catch (err) {
      this.logger.warn(
        {
          intakeIssueId,
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
    const evidenceForQuotes = block.evidence
      .slice(0, 6)
      .filter((e) => !!e.quote && e.quote.length > 0);

    const labelByPersonId = await this.resolveEvidenceAuthorLabels(
      block.tenantId,
      evidenceForQuotes,
    );
    const quotes = evidenceForQuotes.map((e) => {
      const authorLabel =
        (e.authorLabel && e.authorLabel.trim().length > 0
          ? e.authorLabel.trim()
          : e.authorPersonId
            ? labelByPersonId.get(e.authorPersonId) ?? null
            : null) ?? null;
      return { quote: e.quote, authorLabel };
    });

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

  private async resolveEvidenceAuthorLabels(
    tenantId: string,
    evidence: IdeaBlockEvidence[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = Array.from(
      new Set(
        evidence
          .filter((e) => !e.authorLabel || e.authorLabel.trim().length === 0)
          .map((e) => e.authorPersonId)
          .filter((id): id is string => !!id),
      ),
    );
    if (ids.length === 0) return out;
    try {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const p of persons) {
        if (p.name && p.name.trim().length > 0) out.set(p.id, p.name.trim());
      }
    } catch {
      return out;
    }
    return out;
  }

  private normalizePriority(input: unknown): string {
    if (input === 'low' || input === 'medium' || input === 'high') return input;
    return '';
  }

  private pickSetterAuthorPersonId(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
    draft: TaskDraft,
  ): string | null {
    const sourceQuote = (draft.sourceQuote ?? '').trim();
    if (sourceQuote) {
      const matched = block.evidence.find(
        (e) =>
          !!e.authorPersonId &&
          !!e.quote &&
          (e.quote.includes(sourceQuote) || sourceQuote.includes(e.quote)),
      );
      if (matched?.authorPersonId) return matched.authorPersonId;
    }
    const firstWithAuthor = block.evidence.find((e) => !!e.authorPersonId);
    return firstWithAuthor?.authorPersonId ?? null;
  }

  private async resolveSetterRecipient(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
    draft: TaskDraft,
  ): Promise<string | null> {
    const authorPersonId = this.pickSetterAuthorPersonId(block, draft);
    if (authorPersonId) {
      const person = await this.prisma.person.findFirst({
        where: { tenantId: block.tenantId, id: authorPersonId, userId: { not: null } },
        select: { userId: true },
      });
      if (person?.userId) return person.userId;
    }
    return this.resolveProbeRecipient(block.tenantId);
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

  async runClarifySweep(
    now: Date = new Date(),
  ): Promise<{ orgsScanned: number; probed: number }> {
    if (!this.probe || !this.cfg) return { orgsScanned: 0, probed: 0 };
    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.taskClarifySweep.enabled',
      undefined,
      true,
    );
    if (!enabled) return { orgsScanned: 0, probed: 0 };
    const minAgeHours = await this.cfg.getDynamic<number>(
      'tracker.taskClarifySweep.minAgeHours',
      undefined,
      20,
    );
    const cutoff = new Date(now.getTime() - minAgeHours * 3600_000);
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });
    let probed = 0;
    for (const org of orgs) {
      const intakes = await this.prisma.intakeIssue.findMany({
        where: {
          tenantId: org.id,
          status: 'pending',
          createdAt: { lt: cutoff },
          OR: [{ suggestedAssigneeId: null }, { suggestedDueDate: null }],
        },
        select: {
          id: true,
          tenantId: true,
          extractedTitle: true,
          extractedDescription: true,
          suggestedAssigneeId: true,
          suggestedDueDate: true,
          sourceBlockIds: true,
        },
        take: 200,
      });
      for (const intake of intakes) {
        try {
          const setter = await this.resolveSetterRecipientFromIntake(intake);
          const recipient = setter.recipient;
          if (!recipient) continue;
          const title = intake.extractedTitle ?? 'задача';
          const askAssignee = intake.suggestedAssigneeId == null;
          const res = await this.probe.suggest({
            tenantId: intake.tenantId,
            emittedByService: 'specialist-3-15-tasks-sweep',
            reason: askAssignee ? 'task.assignee_unresolved' : 'task.due_date_missing',
            payload: {
              contextCardId: intake.id,
              contextCardKind: 'intake_issue',
              contextCardTitle: title,
              objectName: title,
              objectKindRu: 'задача',
              message: askAssignee
                ? `У задачи «${title}» из недавнего разговора так и не определён исполнитель.`
                : `У задачи «${title}» из недавнего разговора так и не указан срок.`,
              suggestedQuestion: askAssignee
                ? `Кому поручить задачу «${title}»?`
                : `К какому сроку нужно сделать «${title}»?`,
              ...(askAssignee
                ? {}
                : { sourceOccurredAtIso: setter.sourceOccurredAtIso }),
            },
            recipientCandidates: [recipient],
            priorityHint: this.cfg.tracker.assigneeProbePriorityHint,
          });
          if (!('dropped' in res)) probed++;
        } catch {
          // best-effort: одна задача не валит проход
        }
      }
    }
    return { orgsScanned: orgs.length, probed };
  }

  private async resolveSetterRecipientFromIntake(intake: {
    tenantId: string;
    extractedDescription: string | null;
    sourceBlockIds: string[];
  }): Promise<{ recipient: string | null; sourceOccurredAtIso: string | undefined }> {
    const blockId = intake.sourceBlockIds[0];
    if (blockId) {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id_tenantId: { id: blockId, tenantId: intake.tenantId } },
        include: {
          evidence: { orderBy: { sourceTimestamp: { sort: 'asc', nulls: 'last' } } },
        },
      });
      if (block) {
        const draft = { sourceQuote: intake.extractedDescription ?? '' } as TaskDraft;
        return {
          recipient: await this.resolveSetterRecipient(block, draft),
          sourceOccurredAtIso: block.evidence[0]?.sourceTimestamp?.toISOString(),
        };
      }
    }
    return {
      recipient: await this.resolveProbeRecipient(intake.tenantId),
      sourceOccurredAtIso: undefined,
    };
  }
}

type CreateOutcome =
  | { kind: 'linked'; issueId: string }
  | { kind: 'dedup_pending'; intakeIssueId: string }
  | { kind: 'dedup_pending_semantic'; intakeIssueId: string; distance: number }
  | { kind: 'created'; intakeIssueId: string };

function buildIntakeDedupText(title: string, sourceQuote: string): string {
  const t = title.trim();
  const desc = (sourceQuote ?? '').trim();
  if (t.length === 0 && desc.length === 0) return '';
  if (desc.length === 0) return t;
  return `${t}\n\n${desc}`;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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
