/**
 * ReferralsModule — реферальная программа.
 *
 * Содержит:
 *   - ReferralsService — CRUD профиля + InnLookup verification
 *   - AttributionService — beacon + резолв атрибуции для Org
 *   - ReferralPayoutService — @OnEvent billing.invoice.paid + cron 10-го
 *   - PublicReferralsController — beacon-эндпоинт (rate-limited, public)
 *   - ReferralsController — кабинет реферала
 *   - AdminReferralsController — super_admin
 *
 * Зависимости через @Global:
 *   - PrismaService, RedisService, EventEmitterModule.forRoot()
 *
 * Зависимости через @Module:
 *   - AuthModule — CookieAuthGuard + SuperAdminGuard
 *   - InnLookupModule — `InnLookupService` для verify-inn
 *   - BillingModule — `SeatService` для эффективной базовой цены подписки
 *     (B2 — расчёт `targetClients` шкалы прогресса баннера рефералки)
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §9 + §14 Фаза 6.
 */

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { InnLookupModule } from '../inn-lookup/inn-lookup.module';

import { AdminReferralsController } from './controllers/admin-referrals.controller';
import { PublicReferralsController } from './controllers/public-referrals.controller';
import { ReferralsController } from './controllers/referrals.controller';
import { AttributionService } from './services/attribution.service';
import { ReferralPayoutService } from './services/referral-payout.service';
import { ReferralsService } from './services/referrals.service';

@Module({
  imports: [AuthModule, InnLookupModule, BillingModule],
  controllers: [
    PublicReferralsController,
    ReferralsController,
    AdminReferralsController,
  ],
  providers: [ReferralsService, AttributionService, ReferralPayoutService],
  exports: [ReferralsService, AttributionService, ReferralPayoutService],
})
export class ReferralsModule {}
