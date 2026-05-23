import { Global, Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module';

import { ConversationalIngestAdapter } from './adapters/conversational-ingest.adapter';
import { EmailSmtpChannelAdapter } from './adapters/email-smtp.adapter';
import { InAppChannelAdapter } from './adapters/in-app.adapter';
import { MaxApiClient } from './adapters/max-bot/max-api-client';
import { MaxBotChannelAdapter } from './adapters/max-bot/max-bot.adapter';
import { MaxWebhooksController } from './adapters/max-bot/max-webhooks.controller';
import { TelegramApiClient } from './adapters/telegram-bot/telegram-api-client';
import { TelegramBotChannelAdapter } from './adapters/telegram-bot/telegram-bot.adapter';
import { TelegramWebhooksController } from './adapters/telegram-bot/telegram-webhooks.controller';
import { ChannelRegistry } from './channel-registry';
import { ConversationalController } from './conversational.controller';
import { ConversationalService } from './conversational.service';
import { ConversationalLinkCodeService } from './link-code.service';
import { ConversationalQueueService } from './queue/conversational-queue.service';
import { ConversationalSendWorker } from './queue/conversational-send.worker';

/**
 * Conversational Channels Foundation (SBA α-1) — двунаправленный омниканальный
 * слой общения с человеком. См. plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md.
 *
 * @Global, чтобы любой потребитель (α-4 Curation, β-5 Probe-Agent,
 * α-5 ChatV2) мог инжектить `ConversationalService` без повторного
 * импорта.
 *
 * Воркер (`ConversationalSendWorker`) живёт IN-PROCESS — повторяет
 * паттерн `WebhookDeliveryWorker`. Отдельного worker-процесса в Z нет.
 *
 * Зависимости (через @Global модули, не требующие импорта):
 *   - PrismaService, RedisService, TypedConfigService, CryptoService,
 *     BusinessMetricsService — все @Global.
 *   - MailService — @Global (MailModule).
 *   - IngestService — @Global (IngestModule).
 *   - VoxService — экспортируется AiModule (@Global) для voice inbound
 *     адаптеров (β-1 zero-button).
 *   - QueryClassifierService — экспортируется DialogLayerModule (@Global)
 *     для intent classify в voice/text inbound адаптеров (β-1 zero-button).
 *
 * Адаптеры (`InAppChannelAdapter`, `EmailSmtpChannelAdapter`) сами
 * регистрируются в `ChannelRegistry` через `onModuleInit()`.
 *
 * β-1 zero-button (2026-05-23): добавлен импорт `DocumentsModule` для
 * `DocumentsService.upload(...)` из Telegram/MAX-адаптеров (document inbound).
 * Удалён `CommandHandlerService` и подписка `command-handler` — slash-команды
 * больше не поддерживаются (см. plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md).
 */
@Global()
@Module({
  imports: [
    // SBA β-1 zero-button — Telegram/MAX-адаптеры инжектят DocumentsService
    // для document inbound. DocumentsModule НЕ @Global, нужно импортировать.
    DocumentsModule,
  ],
  controllers: [
    ConversationalController,
    // SBA β-1 — webhook'и для Telegram/MAX.
    TelegramWebhooksController,
    MaxWebhooksController,
  ],
  providers: [
    ChannelRegistry,
    ConversationalLinkCodeService,
    ConversationalQueueService,
    ConversationalService,
    ConversationalSendWorker,
    ConversationalIngestAdapter,
    InAppChannelAdapter,
    EmailSmtpChannelAdapter,
    // SBA β-1 — Telegram bot.
    TelegramApiClient,
    TelegramBotChannelAdapter,
    // SBA β-1 — MAX bot.
    MaxApiClient,
    MaxBotChannelAdapter,
  ],
  exports: [
    ConversationalService,
    ConversationalIngestAdapter,
    ChannelRegistry,
  ],
})
export class ConversationalModule {}
