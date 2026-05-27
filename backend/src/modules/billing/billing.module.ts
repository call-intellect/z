/**
 * BillingModule — биллинг (Subscription/Invoice/Provider).
 *
 * **Фаза 4 (текущая, ТЗ §14):** ManualBillingProvider + полный набор сервисов
 * + контроллеры + cron + EventEmitter. Без TochkaBillingProvider (Фаза 5).
 *
 * Зависимости через @Global модули:
 *   - PrismaService — @Global, auto-imported.
 *   - RedisService — @Global, auto-imported.
 *   - EventEmitterModule.forRoot() — глобально в AppModule.
 *
 * Зависимость через @Module:
 *   - AuthModule — CookieAuthGuard, SuperAdminGuard
 *   - RbacModule — TenantGuard, @CurrentOrg() decorator
 *   - MeetingsBalanceModule — grant при активации подписки
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7 + §14.
 */

import { Module } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { AuthModule } from '../auth/auth.module';
import { MeetingsBalanceModule } from '../meetings-balance/meetings-balance.module';
import { RbacModule } from '../rbac/rbac.module';

import { AdminBillingController } from './admin-billing.controller';
import { BillingController } from './billing.controller';
import { BILLING_PROVIDER } from './billing.types';
import { ManualBillingProvider } from './providers/manual-billing.provider';
import { BillingCycleCron } from './services/billing-cycle.cron';
import { BillingEventService } from './services/billing-event.service';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoiceService } from './services/invoice.service';
import { ManualBillingService } from './services/manual-billing.service';
import { SeatService } from './services/seat.service';
import { SubscriptionService } from './services/subscription.service';

@Module({
  imports: [AuthModule, RbacModule, MeetingsBalanceModule],
  controllers: [BillingController, AdminBillingController],
  providers: [
    // Pure-сервисы (Фаза 4a).
    SeatService,
    InvoiceNumberService,

    // БД-сервисы (Фаза 4b).
    SubscriptionService,
    InvoiceService,
    BillingEventService,
    ManualBillingService,

    // Cron.
    BillingCycleCron,

    // Провайдеры.
    ManualBillingProvider,
    {
      provide: BILLING_PROVIDER,
      inject: [ManualBillingProvider, TypedConfigService],
      useFactory: (manual: ManualBillingProvider, cfg: TypedConfigService) => {
        const wantsTochka =
          cfg.billing.provider === 'tochka' && cfg.billing.features.tochka;
        // Фаза 5: вернуть TochkaBillingProvider если wantsTochka.
        // Пока — fallback на manual.
        if (wantsTochka) {
          return manual;
        }
        return manual;
      },
    },
  ],
  exports: [
    SeatService,
    InvoiceNumberService,
    SubscriptionService,
    InvoiceService,
    BillingEventService,
    ManualBillingService,
    BILLING_PROVIDER,
  ],
})
export class BillingModule {}
