/**
 * InnLookupModule — ИНН-лукап (Mock + DaData + Tochka в Фазе 7).
 *
 * Зависимости через @Global модули:
 *   - TypedConfigService — @Global, auto-imported.
 *   - RedisService       — @Global, auto-imported.
 *
 * AuthModule импортирован для CookieAuthGuard + SuperAdminGuard.
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §8.
 */

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';

import { DadataAdapter } from './adapters/dadata.adapter';
import { MockAdapter } from './adapters/mock.adapter';
import { TochkaOpenBankingAdapter } from './adapters/tochka.adapter';
import { InnLookupController } from './inn-lookup.controller';
import { InnLookupService } from './inn-lookup.service';

/**
 * BillingModule импортируется ради `TochkaOAuthService` — TochkaAdapter
 * использует его для bearer-токена OpenBanking-запросов. Цикла нет:
 * BillingModule НЕ зависит от InnLookupModule.
 */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [InnLookupController],
  providers: [InnLookupService, MockAdapter, DadataAdapter, TochkaOpenBankingAdapter],
  exports: [InnLookupService],
})
export class InnLookupModule {}
