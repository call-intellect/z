import { Global, Module } from '@nestjs/common';

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
import { CommandHandlerService } from './command-handler.service';
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
 *
 * Адаптеры (`InAppChannelAdapter`, `EmailSmtpChannelAdapter`) сами
 * регистрируются в `ChannelRegistry` через `onModuleInit()`.
 */
@Global()
@Module({
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
    // SBA β-1 — handler для slash-commands.
    CommandHandlerService,
  ],
  exports: [
    ConversationalService,
    ConversationalIngestAdapter,
    ChannelRegistry,
  ],
})
export class ConversationalModule {}
