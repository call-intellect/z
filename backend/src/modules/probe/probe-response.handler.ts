import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma, type DataClass, type ProbeDialogState, type ProbeEvent } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseRussianDueDate } from '../../common/utils/parse-russian-due-date';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { CompanyProfileService } from '../company-foundation/services/company-profile.service';
import { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import { ConversationalService } from '../conversational/conversational.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { AssigneeResolverService } from '../tracker/services/assignee-resolver.service';
import { IssuesService } from '../tracker/services/issues.service';

import { mapExistenceConfirmAnswer } from './existence-confirm.util';
import { ProbeDialogService } from './probe-dialog.service';
import type { NotificationRespondedPayload } from './probe.types';
import {
  PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
  PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
  PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
  PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE,
} from './prompts/probe-response-classify.prompt';

type ProbeResponseOutcome = 'apply' | 'delete' | 'refine' | 'counter_question' | 'unclear';

interface ProbeClassification {
  answer: string;
  value: string;
  outcome: ProbeResponseOutcome;
  confidence: number;
  unclear: boolean;
}

type ClarifyGap =
  | 'assignee_unresolved'
  | 'date_unparsed'
  | 'counter_question';

type ApplyResult =
  | { status: 'applied' }
  | { status: 'noop' }
  | { status: 'skipped_unclear' }
  | { status: 'needs_clarification'; gap: ClarifyGap };

type ApplyMode =
  | { kind: 'unclear' }
  | { kind: 'delete' }
  | { kind: 'counter_question' }
  | { kind: 'value'; value: string; refine: boolean }
  | { kind: 'degraded'; answer: string };

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
    @Inject(AssigneeResolverService)
    private readonly assigneeResolver?: AssigneeResolverService,
    @Optional()
    @Inject(IssuesService)
    private readonly issues?: IssuesService,
    @Optional()
    @Inject(CompanyProfileService)
    private readonly companyProfile?: CompanyProfileService,
    @Optional()
    @Inject(ProbeDialogService)
    private readonly dialog?: ProbeDialogService,
  ) {}

  @OnEvent('notification.responded')
  async handle(event: NotificationRespondedPayload): Promise<void> {
    try {
      if (!event.eventType.startsWith('probe.')) return;
      const explicitProbeId =
        typeof (event.payload as Record<string, unknown>)?.['probeEventId'] === 'string'
          ? ((event.payload as Record<string, unknown>)['probeEventId'] as string)
          : undefined;
      const probe = explicitProbeId
        ? await this.prisma.probeEvent.findFirst({
            where: {
              id: explicitProbeId,
              tenantId: event.tenantId,
              dispatchedNotificationId: event.notificationId,
            },
          })
        : await this.prisma.probeEvent.findFirst({
            where: {
              tenantId: event.tenantId,
              dispatchedNotificationId: event.notificationId,
            },
          });
      if (!probe) {
        this.logger.debug(
          { notificationId: event.notificationId, tenantId: event.tenantId },
          'probe-response: ответ на уведомление без активного ProbeEvent (вероятно устаревший/эскалированный notif) — пропускаю',
        );
        return;
      }
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
        signalTypeHint:
          probe.reason === 'skill.cdm_interview' || probe.reason === 'task.method_capture'
            ? 'reasoning'
            : undefined,
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
          const questionText = this.extractQuestionText(probePayload) ?? probe.reason;
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

      let priorState: ProbeDialogState | null = null;
      let dialogState: ProbeDialogState | null = null;
      if (this.dialog) {
        try {
          priorState = await this.dialog.getActive({
            tenantId: event.tenantId,
            probeEventId: probe.id,
          });
          dialogState = await this.dialog.ensureState({
            tenantId: event.tenantId,
            probeEventId: probe.id,
            recipientUserId: event.recipientUserId,
          });
          if (classification) {
            dialogState = await this.dialog.recordTurn({
              probeEventId: probe.id,
              outcome: classification.outcome,
              collectedValue: classification.value,
              confidence: classification.confidence,
            });
          }
        } catch (err) {
          this.logger.debug(
            { probeId: probe.id, err: err instanceof Error ? err.message : String(err) },
            'probe-dialog: persist state не удался — пропускаю',
          );
        }
      }

      const dialogEnabled = this.cfg.probe.dialogEnabled === true;
      const dialogActive = dialogEnabled && this.dialog !== undefined && classification !== null;
      let escalateThreshold = 1;
      let maxTurns = 0;
      if (dialogActive) {
        escalateThreshold = await this.cfg.getDynamic<number>(
          'probe.dialogEscalateMaxConfidence',
          undefined,
          0.6,
        );
        maxTurns = await this.cfg.getDynamic<number>('probe.dialogMaxTurns', undefined, 2);
      }
      const answerText = this.extractResponseText(event.payload) ?? '';
      let applyResult: ApplyResult | null = null;
      let routed = false;

      const respondingToConfirm =
        dialogActive && priorState?.phase === 'awaiting_confirmation';
      const fromPhase = priorState?.phase ?? 'awaiting_answer';

      if (respondingToConfirm && this.isAffirmation(answerText)) {
        routed = await this.finalizeConfirmedIntent({
          probe,
          event,
          probePayload,
          priorState,
          dialogState,
          maxTurns,
        });
      } else if (dialogActive && classification !== null) {
        if (
          classification.outcome === 'delete' ||
          (classification.outcome === 'apply' && classification.confidence >= escalateThreshold)
        ) {
          await this.sendConfirm({ probe, event, probePayload, classification, fromPhase });
          routed = true;
        } else {
          await this.routeClarifyOrEscalate({
            probe,
            event,
            probePayload,
            dialogState,
            maxTurns,
            fromPhase,
          });
          routed = true;
        }
      } else {
        applyResult = await this.dispatchApply({
          probe,
          event,
          probePayload,
          classification,
        });
      }

      if (!routed) {
        await this.sendAnswerAck({
          tenantId: event.tenantId,
          recipientUserId: event.recipientUserId,
          probePayload,
          probeId: probe.id,
        });
      }

      const applySummary = applyResult
        ? applyResult.status === 'needs_clarification'
          ? `apply=needs_clarification(${applyResult.gap})`
          : `apply=${applyResult.status}`
        : 'apply=none';
      this.logger.log(
        `probe.responded: probeId=${probe.id} eventType=${event.eventType} kind=${kind ?? 'unknown'} classified=${classification ? `${classification.unclear ? 'unclear' : 'ok'}(${classification.confidence.toFixed(2)})` : 'skipped'} ${applySummary} routed=${routed ? 'dialog' : 'ack'} (closing-loop applied)`,
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

  private async dispatchApply(args: {
    probe: ProbeEvent;
    event: NotificationRespondedPayload;
    probePayload: Record<string, unknown>;
    classification: ProbeClassification | null;
  }): Promise<ApplyResult | null> {
    const { probe, event, probePayload, classification } = args;
    let applyResult: ApplyResult | null = null;

    if (
      probe.reason === 'task.assignee_unresolved' ||
      probe.reason === 'task.due_date_missing' ||
      probe.reason === 'task.poorly_specified' ||
      probe.reason === 'task.false_positive'
    ) {
      applyResult = await this.maybeApplyTaskProbeAnswer({
        tenantId: event.tenantId,
        reason: probe.reason,
        actorUserId: event.recipientUserId,
        probePayload,
        eventPayload: event.payload,
        classification,
      });
    }

    if (probe.reason === 'task.completion_detail_missing') {
      applyResult = await this.maybeApplyCompletionDetailAnswer({
        tenantId: event.tenantId,
        actorUserId: event.recipientUserId,
        probePayload,
        eventPayload: event.payload,
        classification,
      });
    }

    if (probe.reason === 'experiment.result_without_lesson') {
      applyResult = await this.maybeApplyExperimentLessonAnswer({
        tenantId: event.tenantId,
        actorUserId: event.recipientUserId,
        probePayload,
        eventPayload: event.payload,
        classification,
      });
    }

    if (probe.reason.startsWith('companyprofile.missing_')) {
      applyResult = await this.maybeApplyCompanyProfileAnswer({
        tenantId: event.tenantId,
        reason: probe.reason,
        actorUserId: event.recipientUserId,
        eventPayload: event.payload,
        classification,
      });
    }

    return applyResult;
  }

  private async routeClarifyOrEscalate(args: {
    probe: ProbeEvent;
    event: NotificationRespondedPayload;
    probePayload: Record<string, unknown>;
    dialogState: ProbeDialogState | null;
    maxTurns: number;
    fromPhase: string;
  }): Promise<void> {
    const turnCount = args.dialogState?.turnCount ?? 1;
    const title = this.toStringOrUndef(args.probePayload.contextCardTitle);
    const question = this.extractQuestionText(args.probePayload) ?? args.probe.reason;
    const dataClass = this.extractDataClass(args.probePayload);

    if (turnCount > args.maxTurns) {
      const userAnswer =
        this.toStringOrUndef(args.dialogState?.collectedValue ?? undefined) ??
        this.extractResponseText(args.event.payload);
      await this.escalateToHuman({
        probe: args.probe,
        question,
        title,
        dataClass,
        userAnswer,
      });
      this.metrics.incProbeDialogTransition({ from: args.fromPhase, to: 'resolved' });
      this.metrics.incProbeDialogOutcome({ outcome: 'escalated_to_human' });
      return;
    }

    try {
      const clarifyText = `Не до конца понял ваш ответ. Уточните, пожалуйста: «${question}»`;
      const notif = await this.conversational.sendNotification({
        tenantId: args.probe.tenantId,
        recipientUserId: args.event.recipientUserId,
        eventType: 'probe.clarify',
        payload: {
          question: clarifyText,
          ...(title ? { objectTitle: title } : {}),
          probeEventId: args.probe.id,
        },
        dataClass,
      });
      await this.prisma.probeEvent.update({
        where: { id: args.probe.id },
        data: { status: 'awaiting_dialog', dispatchedNotificationId: notif.id },
      });
      if (this.dialog) {
        await this.dialog.setPhase({
          probeEventId: args.probe.id,
          phase: 'awaiting_clarification',
        });
      }
      this.metrics.incProbeDialogTransition({
        from: args.fromPhase,
        to: 'awaiting_clarification',
      });
      this.logger.log(
        `probe-clarify: задан уточняющий ход probe=${args.probe.id} turn=${turnCount}`,
      );
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-clarify: отправка уточнения упала (best-effort)',
      );
    }
  }

  private isAffirmation(text: string): boolean {
    const t = (text ?? '').toLowerCase().trim().replace(/[!.\s]+$/u, '');
    if (!t) return false;
    if (
      /(?:^|[^а-яёa-z])(нет|не|но|вместо|замен[а-яё]*|исправ[а-яё]*|поправ[а-яё]*|друг[а-яё]*)(?![а-яёa-z])/u.test(
        t,
      )
    ) {
      return false;
    }
    return /^(да|ага|угу|ок|окей|верно|подтвержд[а-яё]*|применя[а-яё]*|применить|согласн[а-яё]*|именно|правильно|давай[а-яё]*|всё верно|все верно)(?![а-яёa-z])/u.test(
      t,
    );
  }

  private async sendConfirm(args: {
    probe: ProbeEvent;
    event: NotificationRespondedPayload;
    probePayload: Record<string, unknown>;
    classification: ProbeClassification;
    fromPhase: string;
  }): Promise<void> {
    const title = this.toStringOrUndef(args.probePayload.contextCardTitle);
    const verb = args.classification.outcome === 'delete' ? 'удалить' : 'записать';
    const subject = args.classification.value.trim() || title || 'это';
    const preview = `Понял так: ${verb} «${subject}». Применить? Ответьте «да» или поправьте.`;
    try {
      const notif = await this.conversational.sendNotification({
        tenantId: args.probe.tenantId,
        recipientUserId: args.event.recipientUserId,
        eventType: 'probe.confirm',
        payload: {
          question: preview,
          ...(title ? { objectTitle: title } : {}),
          probeEventId: args.probe.id,
        },
        dataClass: this.extractDataClass(args.probePayload),
      });
      await this.prisma.probeEvent.update({
        where: { id: args.probe.id },
        data: { status: 'awaiting_dialog', dispatchedNotificationId: notif.id },
      });
      if (this.dialog) {
        await this.dialog.setPhase({
          probeEventId: args.probe.id,
          phase: 'awaiting_confirmation',
        });
      }
      this.metrics.incProbeDialogTransition({
        from: args.fromPhase,
        to: 'awaiting_confirmation',
      });
      this.logger.log(
        `probe-confirm: echo-back отправлен probe=${args.probe.id} outcome=${args.classification.outcome}`,
      );
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-confirm: отправка echo-back упала (best-effort)',
      );
    }
  }

  private async finalizeConfirmedIntent(args: {
    probe: ProbeEvent;
    event: NotificationRespondedPayload;
    probePayload: Record<string, unknown>;
    priorState: ProbeDialogState | null;
    dialogState: ProbeDialogState | null;
    maxTurns: number;
  }): Promise<boolean> {
    const won = this.dialog ? await this.dialog.finalizeIfPending(args.probe.id) : true;
    if (!won) {
      this.logger.log(`probe-confirm: уже финализировано probe=${args.probe.id} — no-op`);
      return true;
    }
    const stored: ProbeClassification = {
      outcome: this.normalizeOutcome(args.priorState?.outcome),
      value: args.priorState?.collectedValue ?? '',
      answer: args.priorState?.collectedValue ?? '',
      confidence: args.priorState?.confidence ?? 1,
      unclear: false,
    };
    const applyResult = await this.dispatchApply({
      probe: args.probe,
      event: args.event,
      probePayload: args.probePayload,
      classification: stored,
    });
    if (applyResult !== null && applyResult.status === 'needs_clarification') {
      await this.routeClarifyOrEscalate({
        probe: args.probe,
        event: args.event,
        probePayload: args.probePayload,
        dialogState: args.dialogState,
        maxTurns: args.maxTurns,
        fromPhase: 'awaiting_confirmation',
      });
      return true;
    }
    await this.prisma.probeEvent.update({
      where: { id: args.probe.id },
      data: { status: 'applied' },
    });
    this.metrics.incProbeDialogTransition({ from: 'awaiting_confirmation', to: 'resolved' });
    this.metrics.incProbeDialogOutcome({ outcome: 'applied' });
    await this.sendAnswerAck({
      tenantId: args.event.tenantId,
      recipientUserId: args.event.recipientUserId,
      probePayload: args.probePayload,
      probeId: args.probe.id,
    });
    this.logger.log(`probe-confirm: применено probe=${args.probe.id}`);
    return true;
  }

  private async escalateToHuman(args: {
    probe: ProbeEvent;
    question: string;
    title?: string;
    dataClass: DataClass;
    userAnswer?: string;
  }): Promise<void> {
    try {
      const recipients = await this.prisma.membership.findMany({
        where: { orgId: args.probe.tenantId, role: { in: ['owner', 'admin'] } },
        select: { userId: true },
      });
      const userIds = Array.from(new Set(recipients.map((m) => m.userId)));
      const text = `Кора не смогла разобрать ответ на вопрос: «${args.question}».${args.userAnswer ? ` Ответ человека: «${args.userAnswer}».` : ''} Посмотрите, пожалуйста.`;
      for (const userId of userIds) {
        const notif = await this.conversational.sendNotification({
          tenantId: args.probe.tenantId,
          recipientUserId: userId,
          eventType: 'probe.clarify',
          payload: {
            question: text,
            ...(args.title ? { objectTitle: args.title } : {}),
            probeEventId: args.probe.id,
          },
          dataClass: args.dataClass,
        });
        await this.prisma.notification.update({
          where: { id: notif.id },
          data: { responseStatus: null },
        });
      }
      await this.prisma.probeEvent.update({
        where: { id: args.probe.id },
        data: { status: 'escalated_to_human' },
      });
      if (this.dialog) {
        await this.dialog.setPhase({ probeEventId: args.probe.id, phase: 'resolved' });
      }
      this.logger.log(
        `probe-escalate: probe=${args.probe.id} → escalated_to_human, уведомлены owner/admin (${userIds.length})`,
      );
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-escalate: эскалация упала (best-effort)',
      );
    }
  }

  private async maybeApplyTaskProbeAnswer(args: {
    tenantId: string;
    reason: string;
    actorUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classification: ProbeClassification | null;
  }): Promise<ApplyResult> {
    const issueId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!issueId) return { status: 'noop' };
    const contextCardKind = this.toStringOrUndef(args.probePayload.contextCardKind);
    const rawAnswer =
      args.classification?.value?.trim() || this.extractResponseText(args.eventPayload);
    if (!rawAnswer) return { status: 'noop' };

    const mode = this.resolveApplyMode(args.classification, rawAnswer);
    if (mode.kind === 'unclear') return { status: 'skipped_unclear' };
    if (mode.kind === 'counter_question') {
      return { status: 'needs_clarification', gap: 'counter_question' };
    }

    try {
      const isReject =
        mode.kind === 'delete' ||
        (mode.kind === 'degraded' &&
          mapExistenceConfirmAnswer(mode.answer)?.decisionType === 'reject');
      if (isReject) {
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
        return { status: 'applied' };
      }

      const answer = mode.kind === 'value' ? mode.value : mode.answer;

      if (args.reason === 'task.poorly_specified' || args.reason === 'task.false_positive') {
        await this.appendTaskDescription({
          tenantId: args.tenantId,
          issueId,
          contextCardKind,
          answer,
        });
        return { status: 'applied' };
      }

      if (args.reason === 'task.due_date_missing') {
        const due = parseRussianDueDate(answer, this.resolveDueAnchor(args.probePayload));
        if (!due) {
          if (mode.kind === 'value') {
            return { status: 'needs_clarification', gap: 'date_unparsed' };
          }
          return { status: 'noop' };
        }
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
          return { status: 'applied' };
        }
        await this.prisma.issue.updateMany({
          where: { id: issueId, tenantId: args.tenantId, dueDate: null, deletedAt: null },
          data: { dueDate: due },
        });
        return { status: 'applied' };
      }

      if (contextCardKind === 'intake_issue') {
        if (!this.assigneeResolver) return { status: 'noop' };
        const resolution = await this.assigneeResolver.resolve(args.tenantId, answer);
        if (resolution.kind !== 'resolved') {
          if (mode.kind === 'value') {
            return { status: 'needs_clarification', gap: 'assignee_unresolved' };
          }
          return { status: 'noop' };
        }
        await this.prisma.intakeIssue.updateMany({
          where: {
            id: issueId,
            tenantId: args.tenantId,
            suggestedAssigneeId: null,
            status: 'pending',
          },
          data: { suggestedAssigneeId: resolution.userId },
        });
        return { status: 'applied' };
      }

      if (!this.assigneeResolver || !this.issues) return { status: 'noop' };
      const existing = await this.prisma.issueAssignee.findFirst({
        where: { issueId },
        select: { id: true },
      });
      if (existing) return { status: 'noop' };
      const resolution = await this.assigneeResolver.resolve(args.tenantId, answer);
      if (resolution.kind !== 'resolved') {
        if (mode.kind === 'value') {
          return { status: 'needs_clarification', gap: 'assignee_unresolved' };
        }
        return { status: 'noop' };
      }
      await this.issues.addAssignee(
        issueId,
        resolution.userId,
        args.tenantId,
        this.toStringOrUndef(args.actorUserId) ?? resolution.userId,
      );
      return { status: 'applied' };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-probe-apply: best-effort, пропускаю',
      );
      return { status: 'noop' };
    }
  }

  private async maybeApplyCompletionDetailAnswer(args: {
    tenantId: string;
    actorUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classification: ProbeClassification | null;
  }): Promise<ApplyResult> {
    const issueId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!issueId) return { status: 'noop' };
    const rawAnswer =
      args.classification?.value?.trim() || this.extractResponseText(args.eventPayload);
    if (!rawAnswer) return { status: 'noop' };

    const mode = this.resolveApplyMode(args.classification, rawAnswer);
    if (mode.kind === 'unclear') return { status: 'skipped_unclear' };
    if (mode.kind === 'counter_question') {
      return { status: 'needs_clarification', gap: 'counter_question' };
    }
    if (mode.kind === 'delete') return { status: 'noop' };
    if (
      mode.kind === 'degraded' &&
      mapExistenceConfirmAnswer(mode.answer)?.decisionType === 'reject'
    ) {
      return { status: 'noop' };
    }

    const answer = mode.kind === 'value' ? mode.value : mode.answer;
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
      return { status: 'applied' };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'completion-detail-apply: best-effort, пропускаю',
      );
      return { status: 'noop' };
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
      if (prev.includes(addition)) return;
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
    if (prevStripped.includes(addition)) return;
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

  private async maybeApplyExperimentLessonAnswer(args: {
    tenantId: string;
    actorUserId: string;
    probePayload: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
    classification: ProbeClassification | null;
  }): Promise<ApplyResult> {
    const experimentId = this.toStringOrUndef(args.probePayload.contextCardId);
    if (!experimentId) return { status: 'noop' };
    const rawAnswer =
      args.classification?.value?.trim() || this.extractResponseText(args.eventPayload);
    if (!rawAnswer) return { status: 'noop' };

    const mode = this.resolveApplyMode(args.classification, rawAnswer);
    if (mode.kind === 'unclear') return { status: 'skipped_unclear' };
    if (mode.kind === 'counter_question') {
      return { status: 'needs_clarification', gap: 'counter_question' };
    }
    if (mode.kind === 'delete') return { status: 'noop' };
    if (
      mode.kind === 'degraded' &&
      mapExistenceConfirmAnswer(mode.answer)?.decisionType === 'reject'
    ) {
      return { status: 'noop' };
    }

    const answer = mode.kind === 'value' ? mode.value : mode.answer;
    const lessonText = answer.trim().slice(0, 2000);
    if (!lessonText) return { status: 'noop' };

    try {
      const exp = await this.prisma.experiment.findFirst({
        where: { id: experimentId, tenantId: args.tenantId },
        select: { lessonsJson: true },
      });
      if (!exp) return { status: 'noop' };
      const existing = Array.isArray(exp.lessonsJson) ? (exp.lessonsJson as unknown[]) : [];
      const alreadyHas = existing.some(
        (l) =>
          l !== null &&
          typeof l === 'object' &&
          typeof (l as { text?: unknown }).text === 'string' &&
          (l as { text: string }).text.trim() === lessonText,
      );
      if (alreadyHas) return { status: 'noop' };
      const next = [...existing, { text: lessonText, type: 'manual', sourceBlockId: null }];
      await this.prisma.experiment.update({
        where: { id: experimentId },
        data: { lessonsJson: next as unknown as Prisma.InputJsonValue },
      });
      this.logger.log(
        `experiment-lesson-apply: урок дозаписан experiment=${experimentId} (tenant=${args.tenantId})`,
      );
      return { status: 'applied' };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          experimentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'experiment-lesson-apply: best-effort, пропускаю',
      );
      return { status: 'noop' };
    }
  }

  private async maybeApplyCompanyProfileAnswer(args: {
    tenantId: string;
    reason: string;
    actorUserId: string;
    eventPayload: Record<string, unknown>;
    classification: ProbeClassification | null;
  }): Promise<ApplyResult> {
    if (!this.companyProfile) return { status: 'noop' };
    const rawAnswer =
      args.classification?.value?.trim() || this.extractResponseText(args.eventPayload);
    if (!rawAnswer) return { status: 'noop' };

    const mode = this.resolveApplyMode(args.classification, rawAnswer);
    if (mode.kind === 'unclear') return { status: 'skipped_unclear' };
    if (mode.kind === 'counter_question') {
      return { status: 'needs_clarification', gap: 'counter_question' };
    }
    if (mode.kind === 'delete') return { status: 'noop' };
    if (
      mode.kind === 'degraded' &&
      mapExistenceConfirmAnswer(mode.answer)?.decisionType === 'reject'
    ) {
      return { status: 'noop' };
    }

    const answer = mode.kind === 'value' ? mode.value : mode.answer;
    const contentMd = answer.trim().slice(0, 8000);
    if (!contentMd) return { status: 'noop' };
    const value = { contentMd };
    const field =
      args.reason === 'companyprofile.missing_mission'
        ? 'missionJson'
        : args.reason === 'companyprofile.missing_vision'
          ? 'visionJson'
          : args.reason === 'companyprofile.missing_strategy'
            ? 'strategyJson'
            : null;
    if (!field) return { status: 'noop' };

    try {
      const existing = await this.companyProfile.getRaw(args.tenantId);
      const existingField = existing
        ? (existing as unknown as Record<string, unknown>)[field]
        : null;
      if (this.hasNonEmptyContentMd(existingField)) {
        return { status: 'noop' };
      }
      const body =
        field === 'missionJson'
          ? { mission: value }
          : field === 'visionJson'
            ? { vision: value }
            : { strategy: value };
      await this.companyProfile.update({
        tenantId: args.tenantId,
        userId: args.actorUserId,
        body,
      });
      this.logger.log(
        `company-profile-apply: ${args.reason} записано в профиль (tenant=${args.tenantId})`,
      );
      return { status: 'applied' };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          reason: args.reason,
          err: err instanceof Error ? err.message : String(err),
        },
        'company-profile-apply: best-effort, пропускаю',
      );
      return { status: 'noop' };
    }
  }

  private hasNonEmptyContentMd(raw: unknown): boolean {
    if (raw === null || typeof raw !== 'object') return false;
    const contentMd = (raw as { contentMd?: unknown }).contentMd;
    return typeof contentMd === 'string' && contentMd.trim().length > 0;
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

  private normalizeOutcome(raw: unknown): ProbeResponseOutcome {
    if (
      raw === 'apply' ||
      raw === 'delete' ||
      raw === 'refine' ||
      raw === 'counter_question' ||
      raw === 'unclear'
    ) {
      return raw;
    }
    return 'unclear';
  }

  private resolveApplyMode(
    classification: ProbeClassification | null,
    rawAnswer: string,
  ): ApplyMode {
    if (!classification) return { kind: 'degraded', answer: rawAnswer };
    if (classification.unclear) return { kind: 'unclear' };
    switch (classification.outcome) {
      case 'delete':
        return { kind: 'delete' };
      case 'counter_question':
        return { kind: 'counter_question' };
      case 'refine':
        return { kind: 'value', value: classification.value || rawAnswer, refine: true };
      case 'apply':
      default:
        return {
          kind: 'value',
          value: classification.value || rawAnswer,
          refine: false,
        };
    }
  }

  private async tryClassifyResponse(args: {
    eventPayload: Record<string, unknown>;
    probePayload: Record<string, unknown>;
    tenantId: string;
    probeId: string;
    probeReason: string;
  }): Promise<ProbeClassification | null> {
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
        reasoning?: unknown;
        outcome?: unknown;
        value?: unknown;
        confidence?: unknown;
      };
      const outcome = this.normalizeOutcome(parsed.outcome);
      const value = typeof parsed.value === 'string' ? parsed.value : '';
      const confidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;

      const minConfidence = this.cfg.probe.responseClassifyMinConfidence;
      const unclear = outcome === 'unclear' || confidence < minConfidence;

      if (!unclear) {
        const bucket: 'high' | 'medium' = confidence >= 0.85 ? 'high' : 'medium';
        this.metrics.incProbeResponseClassified({ confidence_bucket: bucket });
        return { answer: value, value, outcome, confidence, unclear: false };
      }

      this.metrics.incProbeResponseUnclear({
        originalReason: args.probeReason,
      });
      this.metrics.incProbeResponseClassified({ confidence_bucket: 'low' });
      return { answer: value, value, outcome, confidence, unclear: true };
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: probe-response-classify упал — пропускаю классификацию',
      );
      this.metrics.incProbeDialogDegraded();
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

  private resolveDueAnchor(probePayload: Record<string, unknown>): Date {
    const iso = this.toStringOrUndef(probePayload.sourceOccurredAtIso);
    if (iso) {
      const parsed = new Date(iso);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
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
