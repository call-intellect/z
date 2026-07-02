import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

@Injectable()
export class StrategicAlignmentCron {
  private readonly logger = new Logger(StrategicAlignmentCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Europe/Moscow' })
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'strategic-alignment.cron: проход завершён');
      void this.audit.log({
        action: 'goal.alignment.scheduled',
        metadata: summary,
      });
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'strategic-alignment.cron: непойманная ошибка — повтор завтра',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    orgsScanned: number;
    goalsEnqueued: number;
    enqueueFailures: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let goalsEnqueued = 0;
    let enqueueFailures = 0;

    for (const org of orgs) {
      try {
        const goals = await this.prisma.goal.findMany({
          where: {
            tenantId: org.id,
            status: 'active',
            archivedAt: null,
          },
          select: { id: true },
        });
        for (const g of goals) {
          try {
            await this.coreQueue.enqueueStrategicAlignment({
              tenantId: org.id,
              goalId: g.id,
            });
            goalsEnqueued += 1;
          } catch (err) {
            enqueueFailures += 1;
            this.logger.warn(
              {
                tenantId: org.id,
                goalId: g.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'strategic-alignment.cron: ошибка enqueue — продолжаю',
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'strategic-alignment.cron: ошибка на Org — продолжаю',
        );
      }
    }

    return {
      orgsScanned: orgs.length,
      goalsEnqueued,
      enqueueFailures,
    };
  }
}
