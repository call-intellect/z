import { Module } from '@nestjs/common';

import { BillingModule } from '../../billing/billing.module';
import { AdminSettingsModule } from '../settings/admin-settings.module';

import { AdminPlansController } from './plans.controller';
import { AdminPlansService } from './plans.service';

/**
 * Admin-redesign Фаза 4 (collapse-to-standard, ТЗ 2026-05-31) —
 * `AdminPlansModule`.
 *
 * После collapse-to-standard модуль обслуживает один read-only эндпоинт
 * `GET /api/v1/admin/orgs/plans/current` (см. `AdminPlansController`).
 *
 * Импорты:
 *   - `BillingModule` — для DI `SeatService` (snapshot использует
 *     `calculatePricing('monthly', 0)`, чтобы UI и расчёт цены подписки
 *     были консистентны).
 *   - `AdminSettingsModule` — для DI `AdminSettingsService.getMany([...])`.
 *     Технически модуль `@Global`, но импорт оставляем явным для ясности
 *     зависимостей (см. nestjs-rules «чек-лист нового модуля»).
 *
 * Глобальный `PrismaService` доступен без явного импорта.
 */
@Module({
  imports: [BillingModule, AdminSettingsModule],
  controllers: [AdminPlansController],
  providers: [AdminPlansService],
  exports: [AdminPlansService],
})
export class AdminPlansModule {}
