import { Module } from '@nestjs/common';

import { PersonsModule } from '../persons/persons.module';

import { ChatboxAnalyzeCron } from './chatbox-analyze.cron';
import { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxChatsController } from './chatbox-chats.controller';
import { ChatboxChatsService } from './chatbox-chats.service';
import { ChatboxIngestService } from './chatbox-ingest.service';
import { ChatboxIntegrationController } from './chatbox-integration.controller';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import { ChatboxMembersController } from './chatbox-members.controller';
import { ChatboxMembersService } from './chatbox-members.service';
import { ChatboxSessionService } from './chatbox-session.service';
import { ChatboxSyncCron } from './chatbox-sync.cron';
import { ChatboxSyncService } from './chatbox-sync.service';
import { ChatboxWebhookController } from './chatbox-webhook.controller';
import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';
import { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * ChatboxModule — интеграция с ChatBox (app.agent-lia.ru / «Call Intellect:
 * Чаты»). ТЗ: plans/tz/2026-06-05-chatbox-integration.md.
 *
 * Фаза 2: конфиг интеграции + типизированный API-клиент + выбор воркспейса.
 * Фазы 3/4/6 (синк/webhook/отправка) добавят провайдеры в этот модуль.
 *
 * Зависимости (все @Global, в imports не нужны):
 *   - PrismaModule — PrismaService.
 *   - CryptoModule — CryptoService (шифрование токена).
 *   - RbacModule — RbacService.
 *   - EntitlementsModule — EntitlementService (гейтинг feature.chatbox).
 *   - ConfigModule — TypedConfigService (CHATBOX_API_BASE_URL).
 *   - IngestModule — IngestService (Ф5: мост сессии → RawEvent, @Global).
 *   - AiModule — LlmRouterService (Ф5: LLM-summary сессии, @Global).
 */
@Module({
  imports: [PersonsModule],
  controllers: [
    ChatboxIntegrationController,
    ChatboxWebhookController,
    ChatboxChatsController,
    ChatboxMembersController,
  ],
  providers: [
    ChatboxApiClient,
    ChatboxChatsService,
    ChatboxIntegrationService,
    ChatboxMembersService,
    ChatboxSessionService,
    ChatboxSyncService,
    ChatboxSyncQueueService,
    ChatboxSyncCron,
    ChatboxIngestService,
    ChatboxAnalyzeQueueService,
    ChatboxAnalyzeCron,
  ],
  exports: [
    ChatboxApiClient,
    ChatboxIntegrationService,
    ChatboxSessionService,
    ChatboxSyncService,
    ChatboxSyncQueueService,
    ChatboxIngestService,
    ChatboxAnalyzeQueueService,
  ],
})
export class ChatboxModule {}
