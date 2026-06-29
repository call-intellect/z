import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CheckinExpectationService } from '../services/checkin-expectation.service';
import { DayReportCollectorService } from '../services/day-report-collector.service';
import { getLocalDate } from '../utils/local-date';

@Injectable()
export class DayReportCollectorCron {
  private readonly logger = new Logger(DayReportCollectorCron.name);
  private static readonly LOCK_TTL_SEC = 25 * 3600;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(DayReportCollectorService) private readonly collector: DayReportCollectorService,
    @Inject(CheckinExpectationService)
    private readonly expectations: CheckinExpectationService,
  ) {}

  @Cron('0 5 * * *', { timeZone: 'Europe/Moscow' })
  async tick(): Promise<void> {
    try {
      const enabled = await this.cfg.getDynamic<boolean>('dayReport.enabled', undefined, true);
      if (!enabled) {
        this.logger.debug('day-report-collector.cron: выключен (dayReport.enabled=false) — пропуск');
        return;
      }

      const now = new Date();
      const yest = new Date(now.getTime() - 24 * 3600 * 1000);
      const dateLocal = getLocalDate(yest, 'Europe/Moscow');

      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      let processed = 0;
      let skippedLock = 0;

      for (const org of orgs) {
        const key = `dayreport:collect:${org.id}:${dateLocal}`;
        const set = await this.redis.client.set(
          key,
          '1',
          'EX',
          DayReportCollectorCron.LOCK_TTL_SEC,
          'NX',
        );
        if (set !== 'OK') {
          skippedLock += 1;
          continue;
        }

        try {
          await this.expectations.ensureForDay({ tenantId: org.id, dateLocal });
          await this.collector.assembleAndUpsert({ tenantId: org.id, dateLocal });
          processed += 1;
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              dateLocal,
              err: err instanceof Error ? err.message : String(err),
            },
            'day-report-collector.cron: org пропущен (fail-open)',
          );
        }
      }

      this.logger.debug(
        `day-report-collector.cron: день=${dateLocal} обработано=${processed} пропущено-по-локу=${skippedLock}`,
      );
    } catch (err) {
      this.logger.warn(
        `day-report-collector.cron tick упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
