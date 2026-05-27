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

import { DadataAdapter } from './adapters/dadata.adapter';
import { MockAdapter } from './adapters/mock.adapter';
import { InnLookupController } from './inn-lookup.controller';
import { InnLookupService } from './inn-lookup.service';

@Module({
  imports: [AuthModule],
  controllers: [InnLookupController],
  providers: [InnLookupService, MockAdapter, DadataAdapter],
  exports: [InnLookupService],
})
export class InnLookupModule {}
