import { Module } from '@nestjs/common';

import { IntegrationObservabilityModule } from '../integrations-observability/integration-observability.module';
import { PersonsModule } from '../persons/persons.module';

import { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxChatsController } from './chatbox-chats.controller';
import { ChatboxChatsService } from './chatbox-chats.service';
import { ChatboxCustomersController } from './chatbox-customers.controller';
import { ChatboxCustomersService } from './chatbox-customers.service';
import { ChatboxIngestService } from './chatbox-ingest.service';
import { ChatboxIntegrationController } from './chatbox-integration.controller';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import { ChatboxMembersController } from './chatbox-members.controller';
import { ChatboxMembersService } from './chatbox-members.service';
import { ChatboxSessionService } from './chatbox-session.service';
import { ChatboxStuckRecoveryCron } from './chatbox-stuck-recovery.cron';
import { ChatboxSyncCron } from './chatbox-sync.cron';
import { ChatboxSyncService } from './chatbox-sync.service';
import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';
import { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

@Module({
  imports: [PersonsModule, IntegrationObservabilityModule],
  controllers: [
    ChatboxIntegrationController,
    ChatboxChatsController,
    ChatboxMembersController,
    ChatboxCustomersController,
  ],
  providers: [
    ChatboxApiClient,
    ChatboxChatsService,
    ChatboxIntegrationService,
    ChatboxMembersService,
    ChatboxCustomersService,
    ChatboxSessionService,
    ChatboxSyncService,
    ChatboxSyncQueueService,
    ChatboxSyncCron,
    ChatboxIngestService,
    ChatboxAnalyzeQueueService,
    ChatboxStuckRecoveryCron,
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
