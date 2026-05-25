import { Module } from '@nestjs/common';

import { FeatureFlagsController } from './flags/feature-flags.controller';
import { FeatureFlagsService } from './flags/feature-flags.service';
import { LimitsAdminController } from './limits/limits-admin.controller';
import { LimitsAdminService } from './limits/limits-admin.service';
import { MaintenanceAdminController } from './maintenance/maintenance-admin.controller';
import { MaintenanceAdminService } from './maintenance/maintenance-admin.service';
import { SecurityAdminController } from './security/security-admin.controller';
import { SecurityAdminService } from './security/security-admin.service';
import { WorkersAdminController } from './workers/workers-admin.controller';
import { WorkersAdminService } from './workers/workers-admin.service';

/**
 * Admin-redesign Фаза 8 — `PlatformAdminModule`.
 *
 * Зонтичный модуль раздела «Платформа» в Z-Admin:
 *   - Workers — BullMQ-inspector (pause/resume/retry/delete).
 *   - Limits — глобальные лимиты (обёртка над AdminSettings).
 *   - Feature Flags — CRUD флагов + override + rollout.
 *   - Security — Argon2/JWT TTL/IP-salt (обёртка над AdminSettings, severity=high).
 *   - Maintenance — статус бэкапов + maintenance windows.
 *
 * Зависит только от @Global-модулей (PrismaService, RedisService,
 * AdminSettingsService) — последний экспортируется AdminSettingsModule.
 */
@Module({
  controllers: [
    WorkersAdminController,
    LimitsAdminController,
    FeatureFlagsController,
    SecurityAdminController,
    MaintenanceAdminController,
  ],
  providers: [
    WorkersAdminService,
    LimitsAdminService,
    FeatureFlagsService,
    SecurityAdminService,
    MaintenanceAdminService,
  ],
  exports: [
    WorkersAdminService,
    LimitsAdminService,
    FeatureFlagsService,
    SecurityAdminService,
    MaintenanceAdminService,
  ],
})
export class PlatformAdminModule {}
