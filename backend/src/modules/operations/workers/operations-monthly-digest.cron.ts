import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MonthlyDigestService } from '../services/monthly-digest.service';
import { shiftPeriod } from '../services/value-recap.service';
import { getLocalDate, getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class OperationsMonthlyDigestCron {
  private readonly logger = new Logger(OperationsMonthlyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MonthlyDigestService)
    private readonly digestService: MonthlyDigestService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.betaOps.monthlyDigestEnabled) {
      this.logger.debug('operations-monthly-digest.cron: COO_MONTHLY_DIGEST_ENABLED=false, skip');
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.debug(stats, 'operations-monthly-digest.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'operations-monthly-digest.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    digestsGenerated: number;
    digestsSkippedAlreadyExists: number;
    skippedOutsideWindow: number;
    errors: number;
  }> {
    const tz = 'Europe/Moscow';
    const localDate = getLocalDate(now, tz);
    const localHour = getLocalHour(now, tz);
    const targetHour = this.cfg.betaOps.monthlyDigestLocalHour;

    if (localDate.slice(8, 10) !== '01' || localHour !== targetHour) {
      return {
        digestsGenerated: 0,
        digestsSkippedAlreadyExists: 0,
        skippedOutsideWindow: 1,
        errors: 0,
      };
    }

    const currentPeriodYm = localDate.slice(0, 7);
    const periodYm = shiftPeriod(currentPeriodYm, -1);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let digestsGenerated = 0;
    let digestsSkippedAlreadyExists = 0;
    let errors = 0;

    for (const org of orgs) {
      const existing = await this.digestService.getStored({
        tenantId: org.id,
        periodYm,
      });
      if (existing) {
        digestsSkippedAlreadyExists++;
        continue;
      }
      try {
        await this.digestService.getOrGenerate({ tenantId: org.id, periodYm });
        digestsGenerated++;
      } catch (err) {
        errors++;
        this.metrics.incCooMonthlyDigestFailed({
          tenantTop: resolveOperationsTenantTop(org.id),
          reason: 'exception',
        });
        this.logger.warn(
          {
            tenantId: org.id,
            periodYm,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-monthly-digest.cron: ошибка генерации',
        );
      }
    }

    return {
      digestsGenerated,
      digestsSkippedAlreadyExists,
      skippedOutsideWindow: 0,
      errors,
    };
  }
}
