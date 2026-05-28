import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * Sprints (2026-05-27, plans/tz/2026-05-27-sprints.md §2.6) — Cron для
 * помощника по спринтам.
 *
 * Каждые 4 часа выгребает активные спринты (status='started' семантически =
 * `completedAt IS NULL AND endDate >= now`) и enqueue'ит 3-13-sprint-helper.
 * BullMQ jobId-дедуп гарантирует, что параллельный manual-trigger не плодит
 * дубли.
 *
 * Cap: не более 50 спринтов за тик (на старте достаточно, при росте Org —
 * расширим в отдельном sub-ТЗ).
 */
@Injectable()
export class SprintHelperCron {
  private readonly logger = new Logger(SprintHelperCron.name);
  private static readonly BATCH_CAP = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  @Cron('0 */4 * * *', { name: 'sprint-helper-cron' })
  async tick(): Promise<void> {
    const now = new Date();
    let cycles;
    try {
      cycles = await this.prisma.cycle.findMany({
        where: {
          completedAt: null,
          endDate: { gte: now },
        },
        orderBy: [{ startDate: 'asc' }],
        take: SprintHelperCron.BATCH_CAP,
        select: { id: true, tenantId: true },
      });
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'sprint-helper.cron: query failed',
      );
      return;
    }
    if (cycles.length === 0) return;

    this.logger.log(`sprint-helper.cron: enqueue для ${cycles.length} активных циклов`);
    for (const c of cycles) {
      try {
        await this.coreQueue.enqueueSprintHelper({
          cycleId: c.id,
          tenantId: c.tenantId,
          reason: 'cron',
        });
      } catch (err) {
        this.logger.warn(
          {
            cycleId: c.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-helper.cron: enqueue failed — пропускаем цикл',
        );
      }
    }
  }
}
