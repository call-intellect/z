import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

@Injectable()
export class SprintHelperCron {
  private readonly logger = new Logger(SprintHelperCron.name);
  private static readonly PER_TENANT_CAP = 5;
  private static readonly GLOBAL_HARD_CAP = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  @Cron('0 */4 * * *', { name: 'sprint-helper-cron' })
  async tick(): Promise<void> {
    const now = new Date();
    let cycles: Array<{ id: string; tenantId: string }>;
    try {
      cycles = await this.prisma.$queryRaw<Array<{ id: string; tenantId: string }>>`
        WITH ranked AS (
          SELECT
            "id",
            "tenantId",
            row_number() OVER (
              PARTITION BY "tenantId"
              ORDER BY "startDate" ASC
            ) AS rn
          FROM "Cycle"
          WHERE "completedAt" IS NULL
            AND "endDate" >= ${now}
        )
        SELECT "id", "tenantId"
        FROM ranked
        WHERE rn <= ${SprintHelperCron.PER_TENANT_CAP}
        LIMIT ${SprintHelperCron.GLOBAL_HARD_CAP}
      `;
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'sprint-helper.cron: query failed',
      );
      return;
    }
    if (cycles.length === 0) return;

    const tenantsTouched = new Set(cycles.map((c) => c.tenantId)).size;
    this.logger.debug(
      `sprint-helper.cron: enqueue для ${cycles.length} активных циклов (${tenantsTouched} tenants, per-tenant cap=${SprintHelperCron.PER_TENANT_CAP})`,
    );
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
