import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Decision } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

@Injectable()
export class Specialist33ProbeService {
  private readonly logger = new Logger(Specialist33ProbeService.name);

  static readonly SPECIALIST_NAME = '3-3-decisions';
  private static readonly OUTCOME_UNKNOWN_THRESHOLD_MONTHS = 3;
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

  async checkAndEmitForDecision(decision: Decision): Promise<void> {
    try {
      await this.checkMissingDecider(decision);
    } catch (err) {
      this.logErr('decision.missing_decider', decision.id, err);
    }
    try {
      await this.checkNoDeadlineCritical(decision);
    } catch (err) {
      this.logErr('decision.no_deadline_critical', decision.id, err);
    }
  }

  async emitCompetingVersions(args: {
    tenantId: string;
    decisionId: string;
    decisionStatement: string;
    competingIds: readonly string[];
  }): Promise<void> {
    try {
      const recipients = await this.findOrgAdminsUserIds(args.tenantId);
      if (recipients.length === 0) return;
      const message = `Решение «${args.decisionStatement.slice(0, 120)}» очень похоже на ${args.competingIds.length} существующее(их). Проверить, не дублирующая ли это версия?`;
      await this.emit({
        tenantId: args.tenantId,
        decisionId: args.decisionId,
        reason: 'decision.competing_versions',
        message,
        recipients,
        suggestedActions: ['Объединить с существующим', 'Создать как новое решение'],
      });
    } catch (err) {
      this.logErr('decision.competing_versions', args.decisionId, err);
    }
  }

  @Cron('0 5 * * *')
  async runDailyChecks(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let totalOverdue = 0;
      let totalOutcome = 0;
      for (const org of orgs) {
        try {
          totalOverdue += await this.checkOverdueForOrg(org.id);
          totalOutcome += await this.checkOutcomeUnknownForOrg(org.id);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-3.cron: ошибка обработки Org — пропускаю',
          );
        }
      }
      this.logger.log(
        { orgs: orgs.length, totalOverdue, totalOutcome },
        'specialist-3-3.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-3.cron: непойманная ошибка',
      );
    }
  }

  private async checkMissingDecider(decision: Decision): Promise<void> {
    if (decision.decidedByPersonIds.length > 0) return;
    if (decision.status !== 'approved') return;

    const recipients = await this.findParticipantsOrAdmins(decision);
    if (recipients.length === 0) return;
    const stmt = (decision.statement ?? decision.text ?? '').slice(0, 120);
    const message = `Решение «${stmt}» зафиксировано, но автор не определён. Кто его принял?`;
    await this.emit({
      tenantId: decision.tenantId,
      decisionId: decision.id,
      reason: 'decision.missing_decider',
      message,
      recipients,
      suggestedActions: ['Указать автора решения', 'Архивировать'],
    });
  }

  private async checkNoDeadlineCritical(decision: Decision): Promise<void> {
    if (decision.status !== 'approved') return;
    if (decision.deadline) return;
    if (decision.sourceBlockIds.length === 0) return;

    const criticalBlock = await this.prisma.ideaBlock.findFirst({
      where: {
        id: { in: decision.sourceBlockIds },
        tenantId: decision.tenantId,
        tags: { has: 'critical' },
      },
      select: { id: true },
    });
    if (!criticalBlock) return;

    const recipients = await this.resolveOwnerOrAdmins(decision);
    if (recipients.length === 0) return;
    const stmt = (decision.statement ?? decision.text ?? '').slice(0, 120);
    const message = `Критичное решение «${stmt}» зафиксировано без срока исполнения. Когда оно должно быть выполнено?`;
    await this.emit({
      tenantId: decision.tenantId,
      decisionId: decision.id,
      reason: 'decision.no_deadline_critical',
      message,
      recipients,
      suggestedActions: ['Указать срок исполнения', 'Снять метку «критичное»'],
    });
  }

  private async checkOverdueForOrg(tenantId: string): Promise<number> {
    const now = new Date();
    const overdue = await this.prisma.decision.findMany({
      where: {
        tenantId,
        deadline: { lt: now, not: null },
        status: { notIn: ['implemented', 'cancelled', 'rejected', 'superseded'] },
      },
      take: Specialist33ProbeService.CRON_BATCH_LIMIT,
    });
    let emitted = 0;
    for (const d of overdue) {
      try {
        const recipients = await this.resolveOwnerOrAdmins(d);
        if (recipients.length === 0) continue;
        const stmt = (d.statement ?? d.text ?? '').slice(0, 120);
        const deadlineStr = d.deadline ? d.deadline.toISOString().slice(0, 10) : '—';
        const message = `Решение «${stmt}» просрочено (дедлайн ${deadlineStr}). Что с ним сейчас?`;
        await this.emit({
          tenantId: d.tenantId,
          decisionId: d.id,
          reason: 'decision.overdue',
          message,
          recipients,
          suggestedActions: ['Отметить как реализованным', 'Перенести срок', 'Отменить решение'],
        });
        emitted += 1;
      } catch (err) {
        this.logErr('decision.overdue', d.id, err);
      }
    }
    return emitted;
  }

  private async checkOutcomeUnknownForOrg(tenantId: string): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCMonth(
      cutoff.getUTCMonth() - Specialist33ProbeService.OUTCOME_UNKNOWN_THRESHOLD_MONTHS,
    );
    const decisions = await this.prisma.decision.findMany({
      where: {
        tenantId,
        status: 'implemented',
        actualOutcomes: null,
        decidedAt: { lt: cutoff, not: null },
      },
      take: Specialist33ProbeService.CRON_BATCH_LIMIT,
    });
    let emitted = 0;
    for (const d of decisions) {
      try {
        const recipients = await this.resolveOwnerOrAdmins(d);
        if (recipients.length === 0) continue;
        const stmt = (d.statement ?? d.text ?? '').slice(0, 120);
        const message = `С момента реализации решения «${stmt}» прошло больше ${Specialist33ProbeService.OUTCOME_UNKNOWN_THRESHOLD_MONTHS} мес. Каков фактический результат?`;
        await this.emit({
          tenantId: d.tenantId,
          decisionId: d.id,
          reason: 'decision.outcome_unknown',
          message,
          recipients,
          suggestedActions: ['Записать фактический результат', 'Отметить как неуспешное'],
        });
        emitted += 1;
      } catch (err) {
        this.logErr('decision.outcome_unknown', d.id, err);
      }
    }
    return emitted;
  }

  private async resolveOwnerOrAdmins(decision: Decision): Promise<string[]> {
    const recipients = new Set<string>();
    const ownerPersonId = decision.decidedByPersonIds[0] ?? decision.decidedByPersonId ?? null;
    if (ownerPersonId) {
      const userId = await this.personUserId(ownerPersonId);
      if (userId) recipients.add(userId);
    }
    if (recipients.size === 0) {
      const admins = await this.findOrgAdminsUserIds(decision.tenantId);
      for (const a of admins) recipients.add(a);
    }
    return [...recipients];
  }

  private async findParticipantsOrAdmins(decision: Decision): Promise<string[]> {
    const recipients = new Set<string>();
    try {
      if (decision.sourceBlockIds.length > 0) {
        const evidence = await this.prisma.ideaBlockEvidence.findMany({
          where: { blockId: { in: decision.sourceBlockIds } },
          select: { rawEventId: true },
          take: 50,
        });
        if (evidence.length > 0) {
          const rawIds = [...new Set(evidence.map((e) => e.rawEventId))];
          const rawEvents = await this.prisma.rawEvent.findMany({
            where: {
              id: { in: rawIds },
              tenantId: decision.tenantId,
            },
            select: { sourceExternalId: true, sourceType: true },
          });
          const meetingIds = rawEvents
            .filter((r) => r.sourceType === 'meeting')
            .map((r) => r.sourceExternalId)
            .filter((s): s is string => Boolean(s));
          if (meetingIds.length > 0) {
            const participants = await this.prisma.participant.findMany({
              where: {
                meetingId: { in: meetingIds },
                userId: { not: null },
              },
              select: { userId: true },
              take: 50,
            });
            for (const p of participants) {
              if (p.userId) recipients.add(p.userId);
            }
          }
        }
      }
    } catch (err) {
      this.logger.debug(
        {
          decisionId: decision.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-3.findParticipantsOrAdmins: best-effort упал',
      );
    }
    if (recipients.size === 0) {
      const admins = await this.findOrgAdminsUserIds(decision.tenantId);
      for (const a of admins) recipients.add(a);
    }
    return [...recipients];
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

  private async personUserId(personId: string | null): Promise<string | null> {
    if (!personId) return null;
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { userId: true },
    });
    return person?.userId ?? null;
  }

  private async emit(args: {
    tenantId: string;
    decisionId: string;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
  }): Promise<void> {
    const actionUrl = `/decisions/${args.decisionId}`;
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.tenantId,
          emittedByService: Specialist33ProbeService.SPECIALIST_NAME,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            contextCardId: args.decisionId,
            contextCardKind: 'decision',
            contextCardTitle: args.message.slice(0, 100),
            actionUrl,
            dataClass: 'sensitive',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: 0.6,
          dataClass: 'sensitive',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'decision',
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            decisionId: args.decisionId,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-3 probe: ProbeService.suggest упал — fallback',
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
            specialistName: Specialist33ProbeService.SPECIALIST_NAME,
            reason: args.reason,
            message: args.message,
            cardId: args.decisionId,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            actionUrl,
          },
          dataClass: 'sensitive',
          contextCardId: args.decisionId,
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'decision',
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            decisionId: args.decisionId,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-3 probe: ошибка sendNotification — пропускаю получателя',
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
      'specialist-3-3 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}
