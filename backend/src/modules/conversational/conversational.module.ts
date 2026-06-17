import { Global, Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';

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
import { NotificationBudgetService } from './notification-budget.service';
import { ConversationalQueueService } from './queue/conversational-queue.service';
import { ConversationalSendWorker } from './queue/conversational-send.worker';
import type { InboundMessage } from './types/channel.types';

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
      return;
    }

    try {
      const preferredKinds = await this.conversational.resolveOriginChannelKinds({
        originChannelBindingId: msg.originChannelBindingId,
        userId: msg.userId,
        tenantId: msg.tenantId,
      });
      await this.conversational.sendNotification({
        tenantId: msg.tenantId,
        recipientUserId: msg.userId,
        eventType: 'note.ack',
        payload: { text: 'Записал в память Коры 🧠' },
        dataClass: 'internal',
        ...(preferredKinds.length > 0 ? { preferredChannelKinds: preferredKinds } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { userId: msg.userId, tenantId: msg.tenantId, err: message },
        'free_note ack не отправлен (заметка сохранена) — продолжаю',
      );
    }
  }
}

@Global()
@Module({
  imports: [DocumentsModule, TrackerModule, AccountsModule],
  controllers: [ConversationalController, TelegramWebhooksController, MaxWebhooksController],
  providers: [
    ChannelRegistry,
    ConversationalLinkCodeService,
    ConversationalQueueService,
    ConversationalService,
    NotificationBudgetService,
    ConversationalSendWorker,
    ConversationalIngestAdapter,
    InAppChannelAdapter,
    EmailSmtpChannelAdapter,
    TelegramApiClient,
    TelegramProxyAdminClient,
    TelegramProxyHealthCron,
    TelegramBotChannelAdapter,
    TelegramTaskParserService,
    TelegramBotMessageHandler,
    TelegramDigestCron,
    MaxApiClient,
    MaxBotChannelAdapter,
    ConversationalFreeNoteBridge,
  ],
  exports: [
    ConversationalService,
    ConversationalIngestAdapter,
    ChannelRegistry,
    NotificationBudgetService,
    TelegramApiClient,
    TelegramProxyAdminClient,
    MaxApiClient,
  ],
})
export class ConversationalModule {}
