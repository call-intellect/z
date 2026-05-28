/**
 * TochkaRecurringChargeCron — попытка списания у card_recurring подписок.
 *
 * Расписание: `0 * * * *` (раз в час). Это упрощённый вариант — в проде
 * можно сделать чаще (раз в 15 мин), но при ~500 ACTIVE подписок раз в час
 * достаточно.
 *
 * Условия выборки:
 *   - status = ACTIVE
 *   - autoRenew = true
 *   - renewalMethod = card_recurring
 *   - currentPeriodEnd < now + 3 days  (попытка заранее, чтобы при failure
 *     успеть перейти в PAST_DUE и оповестить клиента до отключения)
 *   - lastRenewalAttemptAt < now - 6 hours  (не долбим чаще 4 раз/сутки)
 *
 * Поведение:
 *   - provider.chargeRecurringSubscription({...}) → pending
 *   - lastRenewalAttemptAt = now
 *   - финализация (статус ACTIVE с новым периодом) приходит через webhook
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.4 + §14 Фаза 5.7.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { BILLING_PROVIDER } from '../billing.types';
import type { BillingProviderPort } from '../providers/billing-provider.port';

const LOCK_KEY = 'billing:tochka-recurring-charge:lock';
const LOCK_TTL_SECONDS = 900; // 15 минут
const LOOKAHEAD_DAYS = 3;
const MIN_ATTEMPT_INTERVAL_HOURS = 6;

@Injectable()
export class TochkaRecurringChargeCron {
  private readonly logger = new Logger(TochkaRecurringChargeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.billing.features.cardRecurring) return;
    if (this.provider.providerName !== 'tochka') return;

    const acquired = await this.redis.client.set(
      LOCK_KEY,
      Date.now().toString(),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.warn(`Лок ${LOCK_KEY} занят — пропускаем`);
      return;
    }

    try {
      const now = new Date();
      const lookahead = new Date(now);
      lookahead.setDate(lookahead.getDate() + LOOKAHEAD_DAYS);
      const minInterval = new Date(now);
      minInterval.setHours(minInterval.getHours() - MIN_ATTEMPT_INTERVAL_HOURS);

      const candidates = await this.prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          autoRenew: true,
          renewalMethod: 'card_recurring',
          providerSubscriptionId: { not: null },
          currentPeriodEnd: { lt: lookahead },
          OR: [
            { lastRenewalAttemptAt: null },
            { lastRenewalAttemptAt: { lt: minInterval } },
          ],
        },
        select: {
          id: true,
          tenantId: true,
          providerSubscriptionId: true,
          monthlyPriceKopecks: true,
          billingPeriod: true,
        },
      });

      let attempted = 0;
      let failed = 0;
      for (const sub of candidates) {
        if (!sub.providerSubscriptionId) continue;
        const amount =
          sub.billingPeriod === 'yearly'
            ? Math.round(sub.monthlyPriceKopecks * 12 * 0.8)
            : sub.monthlyPriceKopecks;
        try {
          await this.provider.chargeRecurringSubscription({
            providerSubscriptionId: sub.providerSubscriptionId,
            amountKopecks: amount,
          });
          attempted += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `charge failed для sub=${sub.id} (org=${sub.tenantId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { lastRenewalAttemptAt: now },
        });
      }

      this.logger.log(
        `TochkaRecurringChargeCron: candidates=${candidates.length} attempted=${attempted} failed=${failed}`,
      );
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => {});
    }
  }
}
