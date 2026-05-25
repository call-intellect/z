import { Module } from '@nestjs/common';

import { AdminPlansController } from './plans.controller';
import { AdminPlansService } from './plans.service';

/**
 * Admin-redesign Фаза 4 — `AdminPlansModule`.
 *
 * CRUD планов продукта (модель Plan). Подключается в `AdminModule`.
 * Глобальный `PrismaService` доступен без явного импорта.
 */
@Module({
  controllers: [AdminPlansController],
  providers: [AdminPlansService],
  exports: [AdminPlansService],
})
export class AdminPlansModule {}
