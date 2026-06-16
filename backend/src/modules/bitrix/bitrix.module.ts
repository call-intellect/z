import { Module } from '@nestjs/common';

import { PersonsModule } from '../persons/persons.module';

import { BitrixAnalyzeCron } from './bitrix-analyze.cron';
import { BitrixApiClient } from './bitrix-api.client';
import { BitrixIngestService } from './bitrix-ingest.service';
import { BitrixInstallController } from './bitrix-install.controller';
import { BitrixIntegrationController } from './bitrix-integration.controller';
import { BitrixIntegrationService } from './bitrix-integration.service';
import { BitrixOAuthController } from './bitrix-oauth.controller';
import { BitrixSyncCron } from './bitrix-sync.cron';
import { BitrixSyncService } from './bitrix-sync.service';
import { BitrixAnalyzeQueueService } from './queue/bitrix-analyze.queue.service';
import { BitrixSyncQueueService } from './queue/bitrix-sync.queue.service';

/**
 * BitrixModule — интеграция с Bitrix24 (установка + жизненный цикл токена).
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 * Покрывает оба способа установки (OAuth-коннект из Коры + ONAPPINSTALL из
 * Маркета), шифрованное хранение токенов, refresh по требованию, проверку
 * соединения и отключение. Синк данных — отдельный следующий этап.
 *
 * Зависимости (все @Global, в imports не нужны):
 *   - PrismaModule — PrismaService.
 *   - CryptoModule — CryptoService (шифрование токенов).
 *   - AuthModule — JwtService (подпись state) + CookieAuthGuard.
 *   - RbacModule — RbacService (ресурс `bitrix`).
 *   - EntitlementsModule — EntitlementService (гейтинг feature.bitrix).
 *   - AdminSettingsModule — AdminSettingsService (kill-switch bitrix.enabled).
 *   - ConfigModule — TypedConfigService (BITRIX_* + publicFrontendUrl).
 */
@Module({
  imports: [PersonsModule], // PersonsService для авто-создания сотрудников при синке
  controllers: [
    BitrixIntegrationController,
    BitrixOAuthController,
    BitrixInstallController,
  ],
  providers: [
    BitrixApiClient,
    BitrixIntegrationService,
    BitrixSyncService,
    BitrixSyncQueueService,
    BitrixSyncCron,
    // Ф4 — посуточный анализ диалогов + мост в knowledge-core.
    BitrixIngestService,
    BitrixAnalyzeQueueService,
    BitrixAnalyzeCron,
  ],
  exports: [
    BitrixApiClient,
    BitrixIntegrationService,
    BitrixSyncService,
    BitrixSyncQueueService,
    // Ф4 — нужны WorkersModule'у (BitrixAnalyzeWorker) и контроллеру.
    BitrixIngestService,
    BitrixAnalyzeQueueService,
  ],
})
export class BitrixModule {}
