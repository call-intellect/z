import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type DataClass } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseRussianDueDate } from '../../common/utils/parse-russian-due-date';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import { ConversationalService } from '../conversational/conversational.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { CurationService } from '../curation/services/curation.service';
import { AssigneeResolverService } from '../tracker/services/assignee-resolver.service';
import { IssuesService } from '../tracker/services/issues.service';

import { mapExistenceConfirmAnswer } from './existence-confirm.util';
import type { NotificationRespondedPayload } from './probe.types';
import {
  PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
  PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
  PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
  PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE,
} from './prompts/probe-response-classify.prompt';

@Injectable()
export class ProbeResponseHandler {
  private readonly logger = new Logger(ProbeResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalIngestAdapter)
    private readonly ingestAdapter: ConversationalIngestAdapter,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Optional()
    @Inject(CurationService)
    private readonly curation?: CurationService,
    @Optional()
    @Inject(AssigneeResolverService)
    private readonly assigneeResolver?: AssigneeResolverService,
    @Optional()
    @Inject(IssuesService)
    private readonly issues?: IssuesService,
  ) {}

  @OnEvent('notification.responded')
  async handle(event: NotificationRespondedPayload): Promise<void> {
    try {
      if (!event.eventType.startsWith('probe.')) return;
      const probe = await this.prisma.probeEvent.findFirst({
        where: {
          tenantId: event.tenantId,
          dispatchedNotificationId: event.notificationId,
        },
      });
      if (!probe) return;
      const kind = await this.lookupDeliveryKind(event.notificationId);

      this.metrics.incProbeResponse({
        eventType: event.eventType,
        kind: kind ?? 'unknown',
      });
      if (probe.dispatchedAt) {
        const sec = (Date.now() - probe.dispatchedAt.getTime()) / 1000;
        this.metrics.observeProbeResponseTime({
          eventType: event.eventType,
          kind: kind ?? 'unknown',
          seconds: sec,
        });
      }

      const probePayload = (probe.payload ?? {}) as Record<string, unknown>;
      const classification = await this.tryClassifyResponse({
        eventPayload: event.payload,
        probePayload,
        tenantId: event.tenantId,
        probeId: probe.id,
        probeReason: probe.reason,
      });

      const ingestPayload: Record<string, unknown> = { ...event.payload };
      if (classification) {
        ingestPayload.parsedAnswer = classification.answer;
        ingestPayload.parsedConfidence = classification.confidence;
        if (classification.unclear) {
          ingestPayload.notification_response_unclear = true;
        }
      }

      await this.ingestResponseAsRawEvent({
        tenantId: event.tenantId,
        userId: event.recipientUserId,
        notificationId: event.notificationId,
        eventType: event.eventType,
        payload: ingestPayload,
        sourceChannelKind: kind,
        contextBlockId: event.contextBlockId,
        contextCardId: event.contextCardId,
        questionText: this.extractQuestionText(probePayload),
        signalTypeHint: probe.reason === 'skill.cdm_interview' ? 'reasoning' : undefined,
      });
      this.metrics.incProbeClosed({
        tenantTop: this.normalizeTenantTop(event.tenantId),
        source: kind ?? 'unknown',
      });
      this.metrics.incProbeOutcome({ outcome: 'answered', reason: probe.reason });

      if (
        this.cfg.subjectMemory.enabled &&
        classification &&
        !classification.unclear &&
        classification.answer
      ) {
        try {
          const questionText =
            this.extractQuestionText(probePayload) ?? probe.reason;
          await this.coreQueue.enqueueSubjectMemoryDerive({
            tenantId: event.tenantId,
            probeEventId: probe.id,
            questionText,
            answerText: classification.answer,
            occurredAtIso: (probe.dispatchedAt ?? new Date()).toISOString(),
          });
        } catch (err) {
          this.logger.debug(
            {
              probeId: probe.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'subject-memory: enqueue derive не удался — пропускаю',
          );
        }
      }

      if (probe.reason === 'regulation.existence_confirm') {
        await this.maybeDecideExistenceConfirm({
          tenantId: event.tenantId,
          reviewerUserId: event.recipientUserId,
          probePayload,
          eventPayload: event.payload,
          classifiedAnswer: classification?.answer,
        });
      }

      if (
        probe.reason === 'task.assignee_unresolved' ||
        probe.reason === 'task.due_date_missing' ||
        probe.reason === 'task.poorly_specified' ||
        probe.reason === 'task.false_positive'
      ) {
        await this.maybeApplyTaskProbeAnswer({
          tenantId: event.tenantId,
          reason: probe.reason,
          actorUserId: event.recipientUserId,
          probePayload,
          eventPayload: event.payload,
          classifiedAnswer: classification?.answer,
        });
      }

      if (probe.reason === 'task.completion_detail_missing') {
        await this.maybeApplyCompletionDetailAnswer({
          tenantId: event.tenantId,
          actorUserId: event.recipientUserId,
          probePayload,
          eventPayload: event.payload,
          classifiedAnswer: classification?.answer,
        });
      }

      if (probe.reason.startsWith('decision.')) {
        await this.maybeApplyDecisionProbeAnswer({
          tenantId: event.tenantId,
          reason: probe.reason,
          actorUserId: event.recipientUserId,
          probePayload,
          eventPayload: event.payload,
          classifiedAnswer: classification?.answer,
        });
      }

      await this.sendAnswerAck({
        tenantId: event.tenantId,
        recipientUserId: event.recipientUserId,
        probePayload,
        probeId: probe.id,
      });

      this.logger.log(
        `probe.responded: probeId=${probe.id} eventType=${event.eventType} kind=${kind ?? 'unknown'} classified=${classification ? `${classification.unclear ? 'unclear' : 'ok'}(${classification.confidence.toFixed(2)})` : 'skipped'} (closing-loop applied)`,
      );
    } catch (err) {
      this.logger.warn(
        {
          notificationId: event.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: внутренняя ошибка — пропускаю',
      );
    }
  }

  private async maybeDecideExistenceConfirm(args: {
    tenantId: string;
    reviewerUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classifiedAnswer?: string;
  }): Promise<void> {
    if (!this.curation) return;
    const contextCardId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!contextCardId) return;

    const answer =
      args.classifiedAnswer && args.classifiedAnswer.trim().length > 0
        ? args.classifiedAnswer
        : this.extractResponseText(args.eventPayload);
    if (!answer) return;

    const mapped = mapExistenceConfirmAnswer(answer);
    if (!mapped) return;

    try {
      const item = await this.prisma.curationItem.findFirst({
        where: {
          tenantId: args.tenantId,
          resourceId: contextCardId,
          status: 'pending',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!item) {
        this.logger.log(
          `existence-confirm: pending CurationItem не найден (tenant=${args.tenantId} card=${contextCardId} decision=${mapped.decisionType}) — пропускаю проводку`,
        );
        return;
      }
      await this.curation.decide({
        tenantId: args.tenantId,
        curationItemId: item.id,
        reviewerUserId: args.reviewerUserId,
        decisionType: mapped.decisionType,
        reasoning: 'existence-confirm: ответ на probe regulation.existence_confirm',
      });
      this.logger.log(
        `existence-confirm: CurationItem ${item.id} → ${mapped.decisionType} (tenant=${args.tenantId} card=${contextCardId})`,
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          contextCardId,
          err: err instanceof Error ? err.message : String(err),
        },
        'existence-confirm: проводка ответа в curation упала (best-effort)',
      );
    }
  }

  private async maybeApplyTaskProbeAnswer(args: {
    tenantId: string;
    reason: string;
    actorUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classifiedAnswer?: string;
  }): Promise<void> {
    const issueId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!issueId) return;
    const contextCardKind = this.toStringOrUndef(
      args.probePayload.contextCardKind,
    );
    const answer =
      args.classifiedAnswer && args.classifiedAnswer.trim().length > 0
        ? args.classifiedAnswer
        : this.extractResponseText(args.eventPayload);
    if (!answer) return;

    try {
      const mapped = mapExistenceConfirmAnswer(answer);
      if (mapped?.decisionType === 'reject') {
        if (contextCardKind === 'intake_issue') {
          await this.prisma.intakeIssue.updateMany({
            where: { id: issueId, tenantId: args.tenantId, status: 'pending' },
            data: { status: 'rejected' },
          });
        } else if (this.issues) {
          await this.issues.softDelete(
            issueId,
            args.tenantId,
            this.toStringOrUndef(args.actorUserId) ?? issueId,
          );
        }
        this.logger.log(
          `task-probe-apply: dismissed issue=${issueId} reason=${args.reason} kind=${contextCardKind ?? 'issue'} (мягкое удаление по ответу человека)`,
        );
        return;
      }

      if (
        args.reason === 'task.poorly_specified' ||
        args.reason === 'task.false_positive'
      ) {
        await this.appendTaskDescription({
          tenantId: args.tenantId,
          issueId,
          contextCardKind,
          answer,
        });
        return;
      }

      if (args.reason === 'task.due_date_missing') {
        const due = parseRussianDueDate(answer, new Date());
        if (!due) return;
        if (contextCardKind === 'intake_issue') {
          await this.prisma.intakeIssue.updateMany({
            where: {
              id: issueId,
              tenantId: args.tenantId,
              suggestedDueDate: null,
              status: 'pending',
            },
            data: { suggestedDueDate: due },
          });
          return;
        }
        await this.prisma.issue.updateMany({
          where: { id: issueId, tenantId: args.tenantId, dueDate: null, deletedAt: null },
          data: { dueDate: due },
        });
        return;
      }

      if (contextCardKind === 'intake_issue') {
        if (!this.assigneeResolver) return;
        const resolution = await this.assigneeResolver.resolve(args.tenantId, answer);
        if (resolution.kind !== 'resolved') return;
        await this.prisma.intakeIssue.updateMany({
          where: {
            id: issueId,
            tenantId: args.tenantId,
            suggestedAssigneeId: null,
            status: 'pending',
          },
          data: { suggestedAssigneeId: resolution.userId },
        });
        return;
      }

      if (!this.assigneeResolver || !this.issues) return;
      const existing = await this.prisma.issueAssignee.findFirst({
        where: { issueId },
        select: { id: true },
      });
      if (existing) return;
      const resolution = await this.assigneeResolver.resolve(args.tenantId, answer);
      if (resolution.kind !== 'resolved') return;
      await this.issues.addAssignee(
        issueId,
        resolution.userId,
        args.tenantId,
        this.toStringOrUndef(args.actorUserId) ?? resolution.userId,
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-probe-apply: best-effort, пропускаю',
      );
    }
  }

  private async maybeApplyCompletionDetailAnswer(args: {
    tenantId: string;
    actorUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classifiedAnswer?: string;
  }): Promise<void> {
    const issueId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!issueId) return;
    const answer =
      args.classifiedAnswer && args.classifiedAnswer.trim().length > 0
        ? args.classifiedAnswer
        : this.extractResponseText(args.eventPayload);
    if (!answer) return;

    if (mapExistenceConfirmAnswer(answer)?.decisionType === 'reject') return;

    const sourceBlockId = `concierge-complete:${args.actorUserId}`;
    const evidenceQuote = answer.slice(0, 2000);
    try {
      await this.prisma.taskClosureCandidate.upsert({
        where: {
          tenantId_issueId_sourceBlockId: {
            tenantId: args.tenantId,
            issueId,
            sourceBlockId,
          },
        },
        create: {
          tenantId: args.tenantId,
          issueId,
          sourceBlockId,
          status: 'pending',
          evidenceQuote,
          rationale: 'Детали выполнения получены ответом на уточнение',
          expiresAt: null,
        },
        update: { evidenceQuote },
      });
      this.logger.log(
        `completion-detail-apply: создан/обновлён кандидат на закрытие issue=${issueId} (tenant=${args.tenantId})`,
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'completion-detail-apply: best-effort, пропускаю',
      );
    }
  }

  private async appendTaskDescription(args: {
    tenantId: string;
    issueId: string;
    contextCardKind?: string;
    answer: string;
  }): Promise<void> {
    const addition = args.answer.trim();
    if (!addition) return;

    if (args.contextCardKind === 'intake_issue') {
      const existing = await this.prisma.intakeIssue.findFirst({
        where: { id: args.issueId, tenantId: args.tenantId, status: 'pending' },
        select: { extractedDescription: true },
      });
      if (!existing) return;
      const prev = existing.extractedDescription?.trim() ?? '';
      const next = prev ? `${prev}\n\n${addition}` : addition;
      await this.prisma.intakeIssue.updateMany({
        where: { id: args.issueId, tenantId: args.tenantId, status: 'pending' },
        data: { extractedDescription: next },
      });
      return;
    }

    const issue = await this.prisma.issue.findFirst({
      where: { id: args.issueId, tenantId: args.tenantId, deletedAt: null },
      select: { description: true, descriptionStripped: true },
    });
    if (!issue) return;
    const prevStripped = issue.descriptionStripped?.trim() ?? '';
    const nextStripped = prevStripped ? `${prevStripped}\n\n${addition}` : addition;
    const data: { descriptionStripped: string; description?: string } = {
      descriptionStripped: nextStripped,
    };
    if (!issue.description || issue.description.trim().length === 0) {
      data.description = addition;
    }
    await this.prisma.issue.updateMany({
      where: { id: args.issueId, tenantId: args.tenantId, deletedAt: null },
      data,
    });
  }

  private async maybeApplyDecisionProbeAnswer(args: {
    tenantId: string;
    reason: string;
    actorUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classifiedAnswer?: string;
  }): Promise<void> {
    const decisionId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!decisionId) return;
    const answer =
      args.classifiedAnswer && args.classifiedAnswer.trim().length > 0
        ? args.classifiedAnswer
        : this.extractResponseText(args.eventPayload);
    if (!answer) return;

    try {
      const mapped = mapExistenceConfirmAnswer(answer);
      if (mapped?.decisionType === 'reject') {
        await this.prisma.decision.updateMany({
          where: { id: decisionId, tenantId: args.tenantId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        this.logger.log(
          `decision-probe-apply: dismissed decision=${decisionId} reason=${args.reason} (мягкое удаление по ответу человека)`,
        );
        return;
      }

      if (args.reason === 'decision.missing_decider') {
        const personId = await this.resolveDeciderPersonId(args.tenantId, answer);
        if (!personId) return;
        await this.prisma.decision.updateMany({
          where: {
            id: decisionId,
            tenantId: args.tenantId,
            deletedAt: null,
            decidedByPersonId: null,
          },
          data: {
            decidedByPersonId: personId,
            decidedByPersonIds: [personId],
          },
        });
        return;
      }

      if (
        args.reason === 'decision.no_deadline_critical' ||
        args.reason === 'decision.overdue'
      ) {
        const due = parseRussianDueDate(answer, new Date());
        if (!due) return;
        if (args.reason === 'decision.no_deadline_critical') {
          await this.prisma.decision.updateMany({
            where: {
              id: decisionId,
              tenantId: args.tenantId,
              deletedAt: null,
              deadline: null,
            },
            data: { deadline: due },
          });
          return;
        }
        await this.prisma.decision.updateMany({
          where: { id: decisionId, tenantId: args.tenantId, deletedAt: null },
          data: { deadline: due },
        });
        return;
      }

      if (args.reason === 'decision.outcome_unknown') {
        await this.prisma.decision.updateMany({
          where: {
            id: decisionId,
            tenantId: args.tenantId,
            deletedAt: null,
            actualOutcomes: null,
          },
          data: { actualOutcomes: answer.trim() },
        });
        return;
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          decisionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'decision-probe-apply: best-effort, пропускаю',
      );
    }
  }

  private async resolveDeciderPersonId(
    tenantId: string,
    answer: string,
  ): Promise<string | null> {
    if (this.assigneeResolver) {
      const resolution = await this.assigneeResolver.resolve(tenantId, answer);
      if (resolution.kind === 'resolved') {
        const person = await this.prisma.person.findFirst({
          where: { tenantId, userId: resolution.userId, deletedAt: null },
          select: { id: true },
        });
        if (person) return person.id;
      }
    }
    const byName = await this.prisma.person.findFirst({
      where: {
        tenantId,
        name: { equals: answer.trim(), mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    return byName?.id ?? null;
  }

  private async sendAnswerAck(args: {
    tenantId: string;
    recipientUserId: string;
    probePayload: Record<string, unknown>;
    probeId: string;
  }): Promise<void> {
    try {
      const title = this.toStringOrUndef(args.probePayload.contextCardTitle);
      const text = title
        ? `Спасибо! Ваш ответ записан в память компании. По теме «${title}».`
        : 'Спасибо! Ваш ответ записан в память компании.';
      await this.conversational.sendNotification({
        tenantId: args.tenantId,
        recipientUserId: args.recipientUserId,
        eventType: 'probe.answer_acknowledged',
        payload: {
          text,
          summary: text,
          ...(title ? { objectTitle: title } : {}),
          probeEventId: args.probeId,
        },
        dataClass: this.extractDataClass(args.probePayload),
      });
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: подтверждение ответа не отправлено — пропускаю',
      );
    }
  }

  private extractDataClass(payload: Record<string, unknown>): DataClass {
    const dc = payload.dataClass;
    if (dc === 'public' || dc === 'internal' || dc === 'sensitive' || dc === 'private') {
      return dc;
    }
    return 'internal';
  }

  private async tryClassifyResponse(args: {
    eventPayload: Record<string, unknown>;
    probePayload: Record<string, unknown>;
    tenantId: string;
    probeId: string;
    probeReason: string;
  }): Promise<{
    answer: string;
    confidence: number;
    unclear: boolean;
  } | null> {
    if (!this.cfg.probe.responseClassifyEnabled) return null;

    const response = this.extractResponseText(args.eventPayload);
    if (!response) return null;

    const question = this.extractQuestionText(args.probePayload) ?? args.probeReason;

    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(
      PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
      PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE({
        question,
        response,
      }),
      { enabled: guardOn, injection: true },
    );

    try {
      const result = await this.llm.call({
        taskType: 'probe-response-classify',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
          schema: PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe-response', id: args.probeId },
        dataClass: 'internal',
      });

      const parsed = JSON.parse(result.text) as {
        answer?: unknown;
        confidence?: unknown;
        requiresFollowup?: unknown;
      };
      const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
      const confidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;

      const minConfidence = this.cfg.probe.responseClassifyMinConfidence;
      if (confidence >= minConfidence) {
        const bucket: 'high' | 'medium' = confidence >= 0.85 ? 'high' : 'medium';
        this.metrics.incProbeResponseClassified({ confidence_bucket: bucket });
        return { answer, confidence, unclear: false };
      }

      this.metrics.incProbeResponseUnclear({
        originalReason: args.probeReason,
      });
      this.metrics.incProbeResponseClassified({ confidence_bucket: 'low' });
      return { answer, confidence, unclear: true };
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: probe-response-classify упал — пропускаю классификацию',
      );
      return null;
    }
  }

  private extractResponseText(payload: Record<string, unknown>): string | undefined {
    if (typeof payload === 'string') return payload;
    for (const key of ['text', 'response', 'body', 'answer'] as const) {
      const v = payload[key];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return undefined;
  }

  private toStringOrUndef(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }

  private extractQuestionText(probePayload: Record<string, unknown>): string | undefined {
    return (
      this.toStringOrUndef(probePayload.formulatedQuestion) ??
      this.toStringOrUndef(probePayload.question) ??
      this.toStringOrUndef(probePayload.suggestedQuestion) ??
      this.toStringOrUndef(probePayload.message)
    );
  }

  private async ingestResponseAsRawEvent(args: {
    tenantId: string;
    userId: string;
    notificationId: string;
    eventType: string;
    payload: Record<string, unknown>;
    sourceChannelKind: string | null;
    contextBlockId: string | null;
    contextCardId: string | null;
    questionText?: string;
    signalTypeHint?: string;
  }): Promise<void> {
    try {
      await this.ingestAdapter.ingestNotificationResponse({
        tenantId: args.tenantId,
        userId: args.userId,
        notificationId: args.notificationId,
        eventType: args.eventType,
        payload: args.payload as Record<string, unknown>,
        sourceChannelKind: args.sourceChannelKind,
        contextBlockId: args.contextBlockId,
        contextCardId: args.contextCardId,
        questionText: args.questionText,
        signalTypeHint: args.signalTypeHint,
      });
    } catch (err) {
      this.logger.warn(
        {
          notificationId: args.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: ingestNotificationResponse упал — продолжаю',
      );
    }
  }

  private normalizeTenantTop(tenantId: string): string {
    if (!tenantId) return 'other';
    return tenantId.slice(0, 8);
  }

  private async lookupDeliveryKind(notificationId: string): Promise<string | null> {
    const d = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId },
      include: { channelBinding: { include: { channel: true } } },
    });
    return d?.channelBinding?.channel?.kind ?? null;
  }
}
