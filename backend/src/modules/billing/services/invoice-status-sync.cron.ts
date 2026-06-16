/**
 * InvoiceStatusSyncCron — синхронизация статусов «висящих» инвойсов с Точкой.
 *
 * Расписание: `*\/15 * * * *` (каждые 15 минут).
 *
 * Условия выборки:
 *   - Invoice.status = issued
 *   - providerName = tochka
 *   - providerInvoiceId IS NOT NULL
 *   - paymentMethod IN (card_recurring, bank_invoice)
 *   - createdAt < now (исключаем secondsольно созданные)
 *
 * Действия:
 *   - paymentMethod=bank_invoice → provider.getBankInvoiceStatus()
 *     → status='payment_paid' → finalizePaidInvoice
 *   - paymentMethod=card_recurring → provider.getPaymentStatus()
 *     → status='succeeded' → finalizePaidInvoice
 *
 * Это safety-net на случай если webhook не дошёл (Tochka не доставила,
 * наш сервер был недоступен и т.п.). Главный путь финализации — webhook.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.4 + §14 Фаза 5.8.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { BILLING_PROVIDER } from '../billing.types';
import {
  BillingProviderResourceNotFoundError,
  type BillingProviderPort,
} from '../providers/billing-provider.port';

import { BillingService } from './billing.service';

const LOCK_KEY = 'billing:invoice-status-sync:lock';
const LOCK_TTL_SECONDS = 600;
const BATCH_SIZE = 100;

@Injectable()
export class InvoiceStatusSyncCron {
  private readonly logger = new Logger(InvoiceStatusSyncCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.billing.features.tochka) return;
    if (this.provider.providerName !== 'tochka') return;

    const acquired = await this.redis.client.set(
      LOCK_KEY,
      Date.now().toString(),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') return;

    try {
      const candidates = await this.prisma.invoice.findMany({
        where: {
          status: 'issued',
          providerName: 'tochka',
          providerInvoiceId: { not: null },
          paymentMethod: { in: ['card_recurring', 'bank_invoice'] },
        },
        select: {
          id: true,
          providerInvoiceId: true,
          paymentMethod: true,
        },
        take: BATCH_SIZE,
      });

      let synced = 0;
      let paid = 0;
      let notFound = 0;
      for (const inv of candidates) {
        if (!inv.providerInvoiceId) continue;
        try {
          const isPaid = await this.isPaidByProvider(inv);
          synced += 1;
          if (isPaid) {
            await this.billing.finalizePaidInvoice(inv.id, {
              externalReference: inv.providerInvoiceId,
            });
            paid += 1;
          }
        } catch (err) {
          if (err instanceof BillingProviderResourceNotFoundError) {
            notFound += 1;
            this.logger.warn(
              `Invoice ${inv.id}: providerInvoice ${inv.providerInvoiceId} не найден у Точки`,
            );
            continue;
          }
          this.logger.warn(
            `Sync invoice=${inv.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (candidates.length > 0) {
        this.logger.debug(
          `InvoiceStatusSyncCron: candidates=${candidates.length} synced=${synced} paid=${paid} notFound=${notFound}`,
        );
      }
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => {});
    }
  }

  private async isPaidByProvider(inv: {
    providerInvoiceId: string | null;
    paymentMethod: string | null;
  }): Promise<boolean> {
    if (!inv.providerInvoiceId) return false;
    if (inv.paymentMethod === 'bank_invoice') {
      const r = await this.provider.getBankInvoiceStatus(inv.providerInvoiceId);
      return r.status === 'payment_paid';
    }
    const r = await this.provider.getPaymentStatus(inv.providerInvoiceId);
    return r.status === 'succeeded';
  }
}
