import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { nextIdeaStatusOnTaskClose } from '../../ideas/services/ideas-rerank.scoring';
import { Specialist36Service } from './specialist-3-6-ideas.service';

@Injectable()
export class IdeaStatusAutoAdvanceService {
  private readonly logger = new Logger(IdeaStatusAutoAdvanceService.name);
  private static readonly MAX_IDEAS_PER_EVENT = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist36Service)
    private readonly specialist36: Specialist36Service,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @OnEvent('tracker.event_occurred')
  async handle(event: {
    type?: string;
    tenantId?: string;
    issue?: { id?: string };
    actor?: { userId?: string | null };
  }): Promise<void> {
    if (event?.type !== 'issue.status_changed_to_done') return;
    const tenantId = event.tenantId;
    const issueId = event.issue?.id;
    if (!tenantId || !issueId) return;

    try {
      const enabled = await this.isEnabled();
      if (!enabled) {
        this.logger.debug('idea-auto-advance: ideas.feed.enabled=false, skip');
        return;
      }

      const issue = await this.prisma.issue.findFirst({
        where: { id: issueId, tenantId },
        select: { id: true, goalId: true },
      });
      if (!issue || !issue.goalId) return;

      const ideas = await this.prisma.idea.findMany({
        where: {
          tenantId,
          goalId: issue.goalId,
          status: { notIn: ['shipped', 'rejected', 'archived'] },
        },
        select: { id: true, status: true },
        take: IdeaStatusAutoAdvanceService.MAX_IDEAS_PER_EVENT,
      });
      if (ideas.length === 0) return;

      const changedByUserId = event.actor?.userId ?? null;

      for (const idea of ideas) {
        const next = nextIdeaStatusOnTaskClose(idea.status);
        if (!next) continue;
        try {
          await this.specialist36.changeStatus({
            tenantId,
            ideaId: idea.id,
            newStatus: next,
            reason: 'auto:linked_task_closed',
            changedByUserId: changedByUserId ?? 'system',
          });
          this.metrics?.incIdeaStatusAutoAdvanced({ to: next });
        } catch (err) {
          this.logger.debug(
            {
              ideaId: idea.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'idea-auto-advance: changeStatus упал — пропускаю идею',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'idea-auto-advance: внутренняя ошибка — пропускаю событие',
      );
    }
  }

  private async isEnabled(): Promise<boolean> {
    if (!this.cfg) return true;
    return this.cfg.getDynamic<boolean>('ideas.feed.enabled', 'IDEAS_FEED_ENABLED', true);
  }
}
