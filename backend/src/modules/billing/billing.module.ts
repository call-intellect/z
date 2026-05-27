/**
 * BillingModule — биллинг (Subscription/Invoice/Provider).
 *
 * **Фаза 5 (текущая):** добавляется TochkaBillingProvider + OAuth + webhook +
 * pay-flow + cron'ы списания. Фабрика `BILLING_PROVIDER` теперь выбирает
 * между ManualBillingProvider и TochkaBillingProvider по
 * `cfg.billing.provider === 'tochka' && cfg.billing.features.tochka`.
 *
 * Webhook автоматически регистрируется в Точке при старте через
 * `onApplicationBootstrap` (с задержкой 1.5с — чтобы HTTP-сервер успел
 * подняться).
 *
 * Зависимости через @Global модули:
 *   - PrismaService — @Global, auto-imported.
 *   - RedisService — @Global, auto-imported.
 *   - EventEmitterModule.forRoot() — глобально в AppModule.
 *
 * Зависимость через @Module:
 *   - AuthModule (CookieAuthGuard, SuperAdminGuard)
 *   - RbacModule (TenantGuard, @CurrentOrg)
 *   - MeetingsBalanceModule (grant при активации подписки)
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7 + §14.
 */

import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { AuthModule } from '../auth/auth.module';
import { MeetingsBalanceModule } from '../meetings-balance/meetings-balance.module';
import { RbacModule } from '../rbac/rbac.module';

import { AdminBillingController } from './admin-billing.controller';
import { BillingTochkaOAuthController } from './billing-tochka-oauth.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingController } from './billing.controller';
import { BILLING_PROVIDER } from './billing.types';
import { ManualBillingProvider } from './providers/manual-billing.provider';
import { TochkaBillingProvider } from './providers/tochka/tochka-billing.provider';
import { TochkaOAuthService } from './providers/tochka/tochka-oauth.service';
import { TochkaWebhookRegistrarService } from './providers/tochka/tochka-webhook-registrar.service';
import { TochkaWebhookVerifierService } from './providers/tochka/tochka-webhook-verifier.service';
import { BillingCycleCron } from './services/billing-cycle.cron';
import { BillingEventService } from './services/billing-event.service';
import { BillingService } from './services/billing.service';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoiceStatusSyncCron } from './services/invoice-status-sync.cron';
import { InvoiceService } from './services/invoice.service';
import { ManualBillingService } from './services/manual-billing.service';
import { SeatService } from './services/seat.service';
import { SubscriptionService } from './services/subscription.service';
import { TochkaRecurringChargeCron } from './services/tochka-recurring-charge.cron';

@Module({
  imports: [AuthModule, RbacModule, MeetingsBalanceModule],
  controllers: [
    BillingController,
    AdminBillingController,
    BillingWebhookController,
    BillingTochkaOAuthController,
  ],
  providers: [
    // Pure-сервисы (Фаза 4a).
    SeatService,
    InvoiceNumberService,

    // БД-сервисы (Фаза 4b).
    SubscriptionService,
    InvoiceService,
    BillingEventService,
    ManualBillingService,

    // Tochka-провайдер (Фаза 5).
    TochkaOAuthService,
    TochkaWebhookVerifierService,
    TochkaWebhookRegistrarService,
    TochkaBillingProvider,

    // Manual-провайдер (fallback).
    ManualBillingProvider,

    // Фабрика выбора провайдера.
    {
      provide: BILLING_PROVIDER,
      inject: [ManualBillingProvider, TochkaBillingProvider, TypedConfigService],
      useFactory: (
        manual: ManualBillingProvider,
        tochka: TochkaBillingProvider,
        cfg: TypedConfigService,
      ) => {
        const wantsTochka =
          cfg.billing.provider === 'tochka' && cfg.billing.features.tochka;
        return wantsTochka ? tochka : manual;
      },
    },

    // Главный фасад (использует BILLING_PROVIDER).
    BillingService,

    // Cron.
    BillingCycleCron,
    TochkaRecurringChargeCron,
    InvoiceStatusSyncCron,
  ],
  exports: [
    SeatService,
    InvoiceNumberService,
    SubscriptionService,
    InvoiceService,
    BillingEventService,
    ManualBillingService,
    BillingService,
    BILLING_PROVIDER,
  ],
})
export class BillingModule implements OnApplicationBootstrap {
  constructor(
    private readonly cfg: TypedConfigService,
    private readonly oauth: TochkaOAuthService,
    private readonly registrar: TochkaWebhookRegistrarService,
    private readonly tochka: TochkaBillingProvider,
  ) {}

  /**
   * При старте бэка в production-Tochka режиме:
   *   1. OAuth-инициализация (логирует authorize URL если нет токенов).
   *   2. Через 1.5с авто-регистрация webhook'а (если TOCHKA_WEBHOOK_AUTO_REGISTER=true).
   *
   * Sandbox-режим или manual-провайдер — ничего не делаем.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.billing.features.tochka) return;
    if (this.cfg.billing.provider !== 'tochka') return;

    await this.oauth.ensureOAuthReady().catch(() => {
      // ensureOAuthReady пишет свой warn-лог — здесь молча
    });

    if (this.cfg.billing.tochka.webhookAutoRegister) {
      // Задержка 1.5с — даём HTTP-серверу подняться к моменту probe-GET от Точки.
      setTimeout(() => {
        void this.registrar.registerOnce(this.tochka);
      }, 1500);
    }
  }
}
