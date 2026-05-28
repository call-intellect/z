/**
 * MeetingsBalanceModule — накопительный баланс встреч (replacement для
 * квоты `meetings_per_month`).
 *
 * Зависимости через @Global модули:
 *   - PrismaService — @Global, auto-imported.
 *
 * AuthModule + RbacModule импортированы для CookieAuthGuard + TenantGuard.
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §10.
 */

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';

import { MeetingsBalanceController } from './meetings-balance.controller';
import { MeetingsBalanceService } from './meetings-balance.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [MeetingsBalanceController],
  providers: [MeetingsBalanceService],
  exports: [MeetingsBalanceService],
})
export class MeetingsBalanceModule {}
