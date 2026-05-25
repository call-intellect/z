import { Module } from '@nestjs/common';

import { AdminBotsController } from './bots/admin-bots.controller';
import { AdminBotsService } from './bots/admin-bots.service';
import { AdminLiveKitController } from './livekit/admin-livekit.controller';
import { AdminLiveKitService } from './livekit/admin-livekit.service';
import { AdminWebhooksMgmtController } from './webhooks/admin-webhooks-mgmt.controller';
import { AdminWebhooksMgmtService } from './webhooks/admin-webhooks-mgmt.service';

/**
 * Admin-redesign Фаза 6 — `IntegrationsAdminModule`.
 *
 * Зонтичный модуль раздела «Интеграции» в Z-Admin:
 *   - Bots — Telegram / MAX / Email IMAP-inbox (`/admin/integrations/bots/*`).
 *   - Webhooks — управление подписками и доставками `WebhookDelivery`
 *     (`/admin/integrations/webhooks-mgmt/*`).
 *   - LiveKit — SFU / Egress / TURN health + переключение turn_mode
 *     (`/admin/integrations/livekit/*`).
 *
 * Все сервисы зависят только от @Global-модулей (PrismaService, RedisService,
 * TypedConfigService, CryptoService, AdminSettingsService) и от
 * TelegramApiClient / MaxApiClient (экспортируются @Global
 * `ConversationalModule`). Дополнительных импортов не требуется.
 */
@Module({
  controllers: [
    AdminBotsController,
    AdminWebhooksMgmtController,
    AdminLiveKitController,
  ],
  providers: [
    AdminBotsService,
    AdminWebhooksMgmtService,
    AdminLiveKitService,
  ],
  exports: [AdminBotsService, AdminWebhooksMgmtService, AdminLiveKitService],
})
export class IntegrationsAdminModule {}
