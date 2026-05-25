import { Global, Module } from '@nestjs/common';

import { ADMIN_SETTINGS_READER_TOKEN } from '../../../common/config/typed-config.service';

import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';

/**
 * Admin-redesign Фаза 0 — `AdminSettingsModule`.
 *
 * Глобальный, чтобы `TypedConfigService.getDynamic(...)` мог инжектить
 * `AdminSettingsService` без явного импорта `AdminSettingsModule` в каждом
 * модуле-потребителе.
 *
 * Дополнительно регистрируем тот же инстанс под строковым токеном
 * `'AdminSettingsService'` — `TypedConfigService` достаёт его через
 * `ModuleRef` по этому токену (lazy resolve, чтобы не плодить циклическую
 * зависимость common ↔ modules/admin/).
 */
@Global()
@Module({
  controllers: [AdminSettingsController],
  providers: [
    AdminSettingsService,
    {
      provide: ADMIN_SETTINGS_READER_TOKEN,
      useExisting: AdminSettingsService,
    },
  ],
  exports: [AdminSettingsService, ADMIN_SETTINGS_READER_TOKEN],
})
export class AdminSettingsModule {}
