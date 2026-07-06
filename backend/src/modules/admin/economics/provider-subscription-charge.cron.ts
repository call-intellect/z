import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function lastDayOfUtcMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

@Injectable()
export class ProviderSubscriptionChargeCron {
  private readonly logger = new Logger(ProviderSubscriptionChargeCron.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron('0 5 * * *', { name: 'provider-subscription-charge' })
  async runScheduled(): Promise<void> {
    try {
      const result = await this.runOnce();
      this.logger.debug(result, 'provider-subscription-charge: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'provider-subscription-charge: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date = new Date()): Promise<{ charged: number }> {
    const providers = await this.prisma.llmProvider.findMany({
      where: {
        billingMode: 'subscription',
        subscriptionStartedAt: { not: null },
        subscriptionMonthlyCostUsd: { not: null },
        deletedAt: null,
      },
    });

    const today = utcDateOnly(now);
    let charged = 0;

    for (const p of providers) {
      if (!p.subscriptionStartedAt || p.subscriptionMonthlyCostUsd === null) continue;
      const startedAt = utcDateOnly(p.subscriptionStartedAt);
      if (today <= startedAt) continue; // не списываем в день старта — старт не первое списание

      const billingDay = Math.min(startedAt.getUTCDate(), lastDayOfUtcMonth(today));
      if (today.getUTCDate() !== billingDay) continue;

      const exists = await this.prisma.llmProviderSubscriptionCharge.findUnique({
        where: { providerId_chargeDate: { providerId: p.id, chargeDate: today } },
      });
      if (exists) continue;

      await this.prisma.llmProviderSubscriptionCharge.create({
        data: {
          providerId: p.id,
          providerName: p.name,
          chargeDate: today,
          amountUsd: p.subscriptionMonthlyCostUsd,
        },
      });
      charged++;
    }

    return { charged };
  }
}
