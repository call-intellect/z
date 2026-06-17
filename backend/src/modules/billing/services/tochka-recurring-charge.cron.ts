import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { BILLING_PROVIDER } from '../billing.types';
import { InvoiceItemKind } from '../billing.types';
import type { BillingProviderPort } from '../providers/billing-provider.port';

import { InvoiceService } from './invoice.service';

const LOCK_KEY = 'billing:tochka-recurring-charge:lock';
const LOCK_TTL_SECONDS = 900;
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
    @Inject(InvoiceService) private readonly invoices: InvoiceService,
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
          OR: [{ lastRenewalAttemptAt: null }, { lastRenewalAttemptAt: { lt: minInterval } }],
        },
        select: {
          id: true,
          tenantId: true,
          providerSubscriptionId: true,
          monthlyPriceKopecks: true,
          billingPeriod: true,
          currentPeriodEnd: true,
        },
      });

      let attempted = 0;
      let failed = 0;
      for (const sub of candidates) {
        if (!sub.providerSubscriptionId) continue;
        if (!sub.currentPeriodEnd) {
          this.logger.warn(
            `sub=${sub.id} (org=${sub.tenantId}) без currentPeriodEnd — пропускаем (некорректное состояние)`,
          );
          continue;
        }
        const amount =
          sub.billingPeriod === 'yearly'
            ? Math.round(sub.monthlyPriceKopecks * 12 * 0.8)
            : sub.monthlyPriceKopecks;

        const periodStart: Date = sub.currentPeriodEnd;
        const periodEnd = new Date(periodStart);
        if (sub.billingPeriod === 'yearly') {
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        } else {
          periodEnd.setMonth(periodEnd.getMonth() + 1);
        }

        let invoiceId: string | null = null;
        try {
          const invoice = await this.invoices.create({
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            periodStart,
            periodEnd,
            items: [
              {
                kind: InvoiceItemKind.BASE,
                qty: sub.billingPeriod === 'yearly' ? 12 : 1,
                unitKopecks: sub.monthlyPriceKopecks,
                totalKopecks: amount,
                note:
                  sub.billingPeriod === 'yearly'
                    ? 'Подписка (годовая, со скидкой 20%)'
                    : 'Подписка (месяц)',
              },
            ],
            paymentMethod: 'card_recurring',
          });
          invoiceId = invoice.id;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `Invoice.create failed для sub=${sub.id} (org=${sub.tenantId}): ${
              err instanceof Error ? err.message : String(err)
            } — charge не делаем, попробуем в следующий тик`,
          );
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { lastRenewalAttemptAt: now },
          });
          continue;
        }

        try {
          const result = await this.provider.chargeRecurringSubscription({
            providerSubscriptionId: sub.providerSubscriptionId,
            amountKopecks: amount,
          });
          await this.prisma.invoice.update({
            where: { id: invoiceId },
            data: {
              providerName: 'tochka',
              providerInvoiceId: result.providerInvoiceId,
              status: 'issued',
              issuedAt: now,
              externalStatus: result.status,
            },
          });
          attempted += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `charge failed для sub=${sub.id} (org=${sub.tenantId}, invoiceId=${invoiceId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { lastRenewalAttemptAt: now },
        });
      }

      this.logger.debug(
        `TochkaRecurringChargeCron: candidates=${candidates.length} attempted=${attempted} failed=${failed}`,
      );
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => {});
    }
  }
}
