import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ConciergeQuotaService } from '../services/concierge-quota.service';

/**
 * SBA γ-2 — daily/monthly reset Concierge quota.
 *
 *   - daily: каждый день в 00:00 UTC обнуляет realtime-счётчик в Redis и
 *     сохраняет snapshot в БД.
 *   - monthly: 1-го числа каждого месяца в 00:00 UTC.
 *
 * Cron-выражения литералом (нельзя через ENV — литералы NestJS @Cron
 * читает на старте). Можно через SchedulerRegistry для динамической
 * перерегистрации (TODO в vNext).
 */
@Injectable()
export class ConciergeQuotaResetCron {
  private readonly logger = new Logger(ConciergeQuotaResetCron.name);

  constructor(
    @Inject(ConciergeQuotaService)
    private readonly quota: ConciergeQuotaService,
  ) {}

  @Cron('0 0 * * *', { name: 'concierge-quota-daily-reset' })
  async resetDaily(): Promise<void> {
    try {
      const result = await this.quota.resetDaily();
      this.logger.log(
        `daily reset: tenants=${result.tenantsReset}`,
      );
    } catch (err) {
      this.logger.error(
        `daily reset failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron('0 0 1 * *', { name: 'concierge-quota-monthly-reset' })
  async resetMonthly(): Promise<void> {
    try {
      const result = await this.quota.resetMonthly();
      this.logger.log(
        `monthly reset: tenants=${result.tenantsReset}`,
      );
    } catch (err) {
      this.logger.error(
        `monthly reset failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
