import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
} from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { DocumentsModule } from '../documents/documents.module';
import { TrackerModule } from '../tracker/tracker.module';

import { ConversationalIngestAdapter } from './adapters/conversational-ingest.adapter';
import { EmailSmtpChannelAdapter } from './adapters/email-smtp.adapter';
import { InAppChannelAdapter } from './adapters/in-app.adapter';
import { MaxApiClient } from './adapters/max-bot/max-api-client';
import { MaxBotChannelAdapter } from './adapters/max-bot/max-bot.adapter';
import { MaxWebhooksController } from './adapters/max-bot/max-webhooks.controller';
import { TelegramApiClient } from './adapters/telegram-bot/telegram-api-client';
import { TelegramBotMessageHandler } from './adapters/telegram-bot/telegram-bot-message.handler';
import { TelegramBotChannelAdapter } from './adapters/telegram-bot/telegram-bot.adapter';
import { TelegramDigestCron } from './adapters/telegram-bot/telegram-digest.cron';
import { TelegramProxyAdminClient } from './adapters/telegram-bot/telegram-proxy-admin.client';
import { TelegramProxyHealthCron } from './adapters/telegram-bot/telegram-proxy-health.cron';
import { TelegramTaskParserService } from './adapters/telegram-bot/telegram-task-parser.service';
import { TelegramWebhooksController } from './adapters/telegram-bot/telegram-webhooks.controller';
import { ChannelRegistry } from './channel-registry';
import { ConversationalController } from './conversational.controller';
import { ConversationalService } from './conversational.service';
import { ConversationalLinkCodeService } from './link-code.service';
import { ConversationalQueueService } from './queue/conversational-queue.service';
import { ConversationalSendWorker } from './queue/conversational-send.worker';
import type { InboundMessage } from './types/channel.types';

/**
 * Bridge: подписывает `ingestFreeNote` на inbound-сообщения типа `free_note`.
 *
 * Без этого моста сообщения от Telegram-бота / в-аппа со «свободной заметкой»
 * долетают до `ConversationalService.dispatchInbound`, но handler'ов под
 * `free_note` нет → сообщение теряется (раньше — DEBUG-лог, теперь — WARN).
 * Паттерн повторяет `ChatV2OmnichannelBridge` для `chat_query`.
 */
@Injectable()
export class ConversationalFreeNoteBridge implements OnModuleInit {
  private readonly logger = new Logger(ConversationalFreeNoteBridge.name);

  constructor(
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(ConversationalIngestAdapter)
    private readonly ingest: ConversationalIngestAdapter,
  ) {}

  onModuleInit(): void {
    this.conversational.subscribeInbound('free_note', async (msg) => {
      await this.handleFreeNote(msg);
    });
    this.logger.log(
      'ConversationalFreeNoteBridge: подписан на inbound free_note через ConversationalService',
    );
  }

  private async handleFreeNote(msg: InboundMessage): Promise<void> {
    if (msg.type !== 'free_note') return;
    try {
      const rawEvent = await this.ingest.ingestFreeNote({
        tenantId: msg.tenantId,
        userId: msg.userId,
        text: msg.text,
        metadata: msg.metadata,
      });
      this.logger.log(
        `free_note ingested: tenantId=${msg.tenantId} userId=${msg.userId} rawEventId=${rawEvent.id}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { userId: msg.userId, tenantId: msg.tenantId, err: message },
        'free_note handler упал — заметка не попала в граф знаний',
      );
      // Не пробрасываем дальше: ConversationalService.dispatchInbound сам ловит
      // exceptions, чтобы один кривой handler не валил весь pipeline.
    }
  }
}

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
 *
 * Commercial-reliability pack (2026-05-29): добавлен `ConversationalFreeNoteBridge`,
 * который подписывает `ingestFreeNote` на inbound type='free_note'. Без него
 * заметки от Telegram-бота терялись (см. plans/tz/2026-05-29-commercial-reliability-package.md).
 */
@Global()
@Module({
  imports: [
    // SBA β-1 zero-button — Telegram/MAX-адаптеры инжектят DocumentsService
    // для document inbound. DocumentsModule НЕ @Global, нужно импортировать.
    DocumentsModule,
    // Wave 3 / Tracker Phase 4 РФ (2026-05-24) — TelegramBotMessageHandler
    // инжектит IntakeService/CommentsService/IssuesService/IntakeAutoTriageQueueService
    // через @Optional() для 4 сценариев бота для задач (text/voice/forward/reply).
    // TrackerModule не импортирует Conversational напрямую (ConversationalService @Global) —
    // циклической зависимости нет.
    TrackerModule,
    // β-9 Phase 6 (2026-05-25) — TelegramBotChannelAdapter инжектит
    // AccountsService.requestMagicLinkForBot для команды `/login`
    // (выпуск magic-link прямо в чат боту). AccountsModule НЕ глобален,
    // импортируем явно. Цикла нет: Accounts → Orgs, обратной ссылки на
    // Conversational нет.
    AccountsModule,
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
    // 2026-05-26 — admin-клиент прокси telegram.crossmark.ru (ТЗ
    // plans/tz/2026-05-26-telegram-via-crossmark-proxy.md). Используется
    // AdminTelegramBotService.resetWebhook → upsertBot и patch-скриптом
    // регистрации в прокси.
    TelegramProxyAdminClient,
    // 2026-05-26 Фаза 5 — periodical health-check прокси, пишет
    // `tg:proxy:healthy` в Redis для админки. Интервал =
    // `TELEGRAM_PROXY_HEALTH_INTERVAL_SEC`.
    TelegramProxyHealthCron,
    TelegramBotChannelAdapter,
    // Wave 3 / Tracker Phase 4 РФ (2026-05-24) — «Telegram-бот для задач».
    // TelegramTaskParserService — LLM-уровень (4 LlmTaskType).
    // TelegramBotMessageHandler — рутер сценариев (text/voice/forward/reply),
    //   инжектится в TelegramBotChannelAdapter через @Optional() и
    //   перехватывает text/voice ДО старого free_note/chat_query pipeline.
    // TelegramDigestCron — @Cron('0 9 * * *') утренний дайджест задач.
    // Tracker-зависимости (IntakeService через intakeIssue.create в parser,
    // IssuesService/CommentsService/IntakeAutoTriageQueueService в handler) —
    // через @Optional(). Полная интеграция: добавить в exports tracker.module:
    // IntakeService, CommentsService, IntakeAutoTriageQueueService.
    TelegramTaskParserService,
    TelegramBotMessageHandler,
    TelegramDigestCron,
    // SBA β-1 — MAX bot.
    MaxApiClient,
    MaxBotChannelAdapter,
    // Commercial-reliability pack (2026-05-29) — мост inbound free_note →
    // ingestFreeNote. Без него Telegram-заметки теряются.
    ConversationalFreeNoteBridge,
  ],
  exports: [
    ConversationalService,
    ConversationalIngestAdapter,
    ChannelRegistry,
    // β-9 Phase 4 — нужен AdminTelegramBotService (валидация токена через
    // getMe, перенастройка webhook через setWebhook).
    TelegramApiClient,
    // 2026-05-26 — нужен AdminTelegramBotService.resetWebhook (через прокси)
    // и patch-скрипт регистрации бота в прокси.
    TelegramProxyAdminClient,
    // β-9 Phase ? — AdminBotsService инжектит MaxApiClient (симметрично
    // TelegramApiClient). Без этого экспорта Nest не резолвит зависимость.
    MaxApiClient,
  ],
})
export class ConversationalModule {}
