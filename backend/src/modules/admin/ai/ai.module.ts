import { Module } from '@nestjs/common';

import { AdminSmokeTestController } from './smoke-test.controller';
import { AdminSmokeTestService } from './smoke-test.service';

/**
 * Admin-redesign Фаза 3 — `AdminAiModule`.
 *
 * Регистрирует серверные части раздела AI админки Z, которые поверх
 * существующих модулей (`ai-models`, `prompt-templates`, `llm-routes`,
 * `economics/admin-llm-providers`). На Фазе 3 — только smoke-test
 * controller/service. Реестр Zod-схем настроек живёт в
 * `settings/admin-setting-schema-registry.ts` и зашит прямо в
 * `AdminSettingsController` (без отдельного провайдера, чтобы не
 * усложнять DI).
 *
 * `ProviderSmokeTestCron` инжектится из глобального `AdminModule` —
 * добавлять его в providers не нужно, иначе получим duplicate-instance.
 */
@Module({
  controllers: [AdminSmokeTestController],
  providers: [AdminSmokeTestService],
  exports: [AdminSmokeTestService],
})
export class AdminAiModule {}
