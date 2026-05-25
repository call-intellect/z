import { Module } from '@nestjs/common';

import { AdminRetentionController } from './retention/admin-retention.controller';
import { AdminRetentionService } from './retention/admin-retention.service';
import { AdminStorageController } from './storage/admin-storage.controller';
import { AdminStorageService } from './storage/admin-storage.service';

/**
 * Admin-redesign Фаза 7 — `AdminMediaModule`.
 *
 * Зонтичный модуль раздела «Записи и медиа» в Z-Admin:
 *   - Retention — управление `RetentionPolicy` (TTL по типу). Пишет в БД +
 *     дублирует в `AdminSetting` (Redis pub/sub в воркеры).
 *   - Storage — S3 buckets stats + переключение провайдера (маркер).
 *
 * Все сервисы зависят только от @Global-модулей (PrismaService,
 * TypedConfigService, AdminSettingsService — последний экспортируется
 * `AdminSettingsModule`).
 */
@Module({
  controllers: [AdminRetentionController, AdminStorageController],
  providers: [AdminRetentionService, AdminStorageService],
  exports: [AdminRetentionService, AdminStorageService],
})
export class AdminMediaModule {}
