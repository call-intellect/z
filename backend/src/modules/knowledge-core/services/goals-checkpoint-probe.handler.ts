import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';

interface IdeaStatusChangedEvent {
  tenantId: string;
  ideaId: string;
  oldStatus: string;
  newStatus: string;
  reason?: string | null;
  changedByUserId?: string;
}

@Injectable()
export class GoalsCheckpointProbeHandler {
  private readonly logger = new Logger(GoalsCheckpointProbeHandler.name);

  static readonly SPECIALIST_NAME = '3-14-goals';
  static readonly REASON = 'goal.kr_checkpoint_suggested';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  @OnEvent('idea.status_changed')
  async handle(event: IdeaStatusChangedEvent): Promise<void> {
    try {
      if (event.newStatus !== 'shipped') return;

      const idea = await this.prisma.idea.findFirst({
        where: { id: event.ideaId, tenantId: event.tenantId },
        select: { id: true, statement: true, goalId: true },
      });
      if (!idea || !idea.goalId) return;

      const goal = await this.prisma.goal.findFirst({
        where: { id: idea.goalId, tenantId: event.tenantId },
        select: {
          id: true,
          name: true,
          createdById: true,
          tenantId: true,
          keyResults: {
            select: {
              id: true,
              name: true,
              currentValue: true,
              targetValue: true,
              unit: true,
            },
          },
        },
      });
      if (!goal) return;

      const recipients = await this.resolveRecipients({
        tenantId: event.tenantId,
        goalCreatedById: goal.createdById,
      });
      if (recipients.length === 0) return;

      const krLine =
        goal.keyResults.length > 0
          ? ` Ключевые результаты: ${goal.keyResults.map((kr) => kr.name).join('; ')}.`
          : '';
      const message =
        `Гипотеза «${idea.statement.slice(0, 100)}» завершена (отгружена). ` +
        `Она была привязана к цели «${goal.name}». Обновить прогресс ` +
        `ключевых результатов этой цели?${krLine}`;

      if (!this.probeService) {
        return;
      }

      try {
        await this.probeService.suggest({
          tenantId: event.tenantId,
          emittedByService: GoalsCheckpointProbeHandler.SPECIALIST_NAME,
          reason: GoalsCheckpointProbeHandler.REASON,
          payload: {
            message,
            contextCardId: goal.id,
            contextCardKind: 'goal',
            actionUrl: `/goals/${goal.id}`,
            suggestedActions: ['Обновить ключевые результаты цели'],
          },
          recipientCandidates: recipients,
          priorityHint: 0.5,
        });
        this.metrics?.incCoreSpecialistProbeEvent({
          type: 'goal',
          reason: 'kr_checkpoint_suggested',
        });
      } catch (err) {
        this.logger.warn(
          {
            ideaId: idea.id,
            goalId: goal.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'goals-checkpoint-probe: ProbeService.suggest упал — пропускаю',
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          ideaId: event.ideaId,
          err: err instanceof Error ? err.message : String(err),
        },
        'goals-checkpoint-probe: внутренняя ошибка — пропускаю',
      );
    }
  }

  private async resolveRecipients(args: {
    tenantId: string;
    goalCreatedById: string;
  }): Promise<string[]> {
    const recipients = new Set<string>();
    if (args.goalCreatedById) recipients.add(args.goalCreatedById);
    const admins = await this.prisma.membership.findMany({
      where: {
        orgId: args.tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 20,
    });
    for (const a of admins) recipients.add(a.userId);
    return [...recipients];
  }
}
