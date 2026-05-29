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
 * Cap (audit-fixes §Б10): per-tenant cap = `PER_TENANT_CAP`. Глобальный
 * cap=50 был кросс-тенантным — крупный tenant с 50+ активными спринтами
 * полностью вытеснял остальных. Используем row_number() OVER (PARTITION BY
 * tenantId) чтобы взять top-N на тенант, отсортированных по startDate.
 *
 * Global safety cap = `GLOBAL_HARD_CAP` (защита от взрыва очереди при
 * аномалии — N тенантов × 5 спринтов).
 */
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
      // Per-tenant top-N через window function. CTE ранжирует активные
      // циклы внутри каждого tenantId по startDate ASC, внешний SELECT
      // берёт rn <= PER_TENANT_CAP. Глобальный LIMIT — защита от
      // патологического роста (миллион тенантов).
      cycles = await this.prisma.$queryRaw<
        Array<{ id: string; tenantId: string }>
      >`
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
    this.logger.log(
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
