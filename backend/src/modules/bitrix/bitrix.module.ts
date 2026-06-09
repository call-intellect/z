import { Module } from '@nestjs/common';

import { BitrixApiClient } from './bitrix-api.client';
import { BitrixInstallController } from './bitrix-install.controller';
import { BitrixIntegrationController } from './bitrix-integration.controller';
import { BitrixIntegrationService } from './bitrix-integration.service';
import { BitrixOAuthController } from './bitrix-oauth.controller';

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
  controllers: [
    BitrixIntegrationController,
    BitrixOAuthController,
    BitrixInstallController,
  ],
  providers: [BitrixApiClient, BitrixIntegrationService],
  exports: [BitrixApiClient, BitrixIntegrationService],
})
export class BitrixModule {}
