import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Insight } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

@Injectable()
export class Specialist35ProbeService {
  private readonly logger = new Logger(Specialist35ProbeService.name);

  static readonly SPECIALIST_NAME = '3-5-insights';
  private static readonly NO_MITIGATION_AGE_DAYS = 7;
  private static readonly CRON_BATCH_LIMIT = 100;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  async checkAndEmitForInsight(args: {
    insight: Insight;
    addedToMitigated: boolean;
  }): Promise<void> {
    try {
      if (args.insight.dynamicLabel === 'spike') {
        await this.emitEscalationSuggested(args.insight);
      }
    } catch (err) {
      this.logErr('insight.escalation_suggested', args.insight.id, err);
    }
    try {
      if (args.addedToMitigated && args.insight.status === 'mitigated') {
        await this.emitRecurringAfterMitigation(args.insight);
      }
    } catch (err) {
      this.logErr('insight.recurring_after_mitigation', args.insight.id, err);
    }
  }

  async emitLinkedDecisionQuestion(args: {
    insight: Insight;
    candidateDecisionIds: readonly string[];
    reasoning: string;
  }): Promise<void> {
    try {
      if (args.candidateDecisionIds.length === 0) return;
      const recipients = await this.findOrgAdminsUserIds(args.insight.tenantId);
      if (recipients.length === 0) return;
      const stmt = args.insight.statement.slice(0, 120);
      const message = `Сигнал «${stmt}» возможно вызван ${args.candidateDecisionIds.length} прошлым решением. Подтвердить связь?`;
      await this.emit({
        tenantId: args.insight.tenantId,
        insightId: args.insight.id,
        reason: 'insight.linked_decision_question',
        message,
        recipients,
        suggestedActions: ['Подтвердить связь с решением', 'Отклонить связь'],
      });
    } catch (err) {
      this.logErr('insight.linked_decision_question', args.insight.id, err);
    }
  }

  async emitEscalationSuggested(insight: Insight): Promise<void> {
    const recipients = await this.findOrgAdminsUserIds(insight.tenantId);
    if (recipients.length === 0) return;
    const stmt = insight.statement.slice(0, 120);
    const reason =
      insight.dynamicLabel === 'spike'
        ? `всплеск повторений`
        : `высокая острота (${insight.severity}) и рост частоты`;
    const message = `Сигнал «${stmt}» требует внимания (${reason}). Эскалировать?`;
    await this.emit({
      tenantId: insight.tenantId,
      insightId: insight.id,
      reason: 'insight.escalation_suggested',
      message,
      recipients,
      suggestedActions: ['Взять в работу', 'Назначить ответственного'],
    });
  }

  private async emitRecurringAfterMitigation(insight: Insight): Promise<void> {
    const recipients = await this.findOrgAdminsUserIds(insight.tenantId);
    if (recipients.length === 0) return;
    const stmt = insight.statement.slice(0, 120);
    const message = `Сигнал «${stmt}» был помечен решённым, но появилось новое упоминание. План реагирования не сработал?`;
    await this.emit({
      tenantId: insight.tenantId,
      insightId: insight.id,
      reason: 'insight.recurring_after_mitigation',
      message,
      recipients,
      suggestedActions: ['Вернуть в работу', 'Обновить план реагирования'],
    });
  }

  async checkNoMitigationPlanForOrg(tenantId: string): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - Specialist35ProbeService.NO_MITIGATION_AGE_DAYS);
    const insights = await this.prisma.insight.findMany({
      where: {
        tenantId,
        severity: { in: ['high', 'critical'] },
        mitigationPlan: null,
        status: 'active',
        firstObservedAt: { lt: cutoff },
      },
      take: Specialist35ProbeService.CRON_BATCH_LIMIT,
    });
    let emitted = 0;
    for (const ins of insights) {
      try {
        const recipients = await this.findOrgAdminsUserIds(ins.tenantId);
        if (recipients.length === 0) continue;
        const stmt = ins.statement.slice(0, 120);
        const message = `У сигнала «${stmt}» (${ins.severity}) уже больше ${Specialist35ProbeService.NO_MITIGATION_AGE_DAYS} дней нет плана реагирования. Что планируется делать?`;
        await this.emit({
          tenantId: ins.tenantId,
          insightId: ins.id,
          reason: 'insight.no_mitigation_plan',
          message,
          recipients,
          suggestedActions: ['Записать план реагирования', 'Понизить остроту'],
        });
        emitted += 1;
      } catch (err) {
        this.logErr('insight.no_mitigation_plan', ins.id, err);
      }
    }
    return emitted;
  }

  private async findOrgAdminsUserIds(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 20,
    });
    return memberships.map((m) => m.userId);
  }

  private async emit(args: {
    tenantId: string;
    insightId: string;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
  }): Promise<void> {
    const actionUrl = `/insights/${args.insightId}`;
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.tenantId,
          emittedByService: Specialist35ProbeService.SPECIALIST_NAME,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            contextCardId: args.insightId,
            contextCardKind: 'insight',
            contextCardTitle: args.message.slice(0, 100),
            actionUrl,
            dataClass: 'internal',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: args.reason.includes('escalation') ? 0.7 : 0.5,
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'insight',
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            insightId: args.insightId,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-5 probe: ProbeService.suggest упал — fallback',
        );
      }
    }
    for (const userId of args.recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'specialist.probe',
          payload: {
            specialistName: Specialist35ProbeService.SPECIALIST_NAME,
            reason: args.reason,
            message: args.message,
            cardId: args.insightId,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            actionUrl,
          },
          dataClass: 'internal',
          contextCardId: args.insightId,
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'insight',
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            insightId: args.insightId,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-5 probe: ошибка sendNotification — пропускаю получателя',
        );
      }
    }
  }

  private logErr(reason: string, id: string, err: unknown): void {
    this.logger.warn(
      {
        resourceId: id,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      'specialist-3-5 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}
