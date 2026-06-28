import { Module } from '@nestjs/common';

import { ConversationController } from './conversation.controller';
import { AccessLinkService } from './external/access-link.service';
import { ExternalConversationController } from './external/external-conversation.controller';
import { ExternalConversationService } from './external/external-conversation.service';
import { ExternalGuestController } from './external/external-guest.controller';
import { ExternalGuestGuard } from './external/external-guest.guard';
import { InboxController } from './inbox.controller';
import { ChatIngestQueueService } from './queue/chat-ingest.queue.service';
import { MessageOutboxQueueService } from './queue/message-outbox.queue.service';
import { VoiceTranscribeQueueService } from './queue/voice-transcribe.queue.service';
import { ChatIngestService } from './services/chat-ingest.service';
import { ConversationService } from './services/conversation.service';
import { InboxService } from './services/inbox.service';
import { MessageService } from './services/message.service';
import { PresenceService } from './services/presence.service';
import { ReadCursorService } from './services/read-cursor.service';
import { WorkChatService } from './services/work-chat.service';

@Module({
  controllers: [
    ConversationController,
    InboxController,
    ExternalConversationController,
    ExternalGuestController,
  ],
  providers: [
    ConversationService,
    MessageService,
    ReadCursorService,
    PresenceService,
    MessageOutboxQueueService,
    ChatIngestQueueService,
    ChatIngestService,
    VoiceTranscribeQueueService,
    WorkChatService,
    InboxService,
    AccessLinkService,
    ExternalConversationService,
    ExternalGuestGuard,
  ],
  exports: [
    ConversationService,
    MessageService,
    ReadCursorService,
    PresenceService,
    MessageOutboxQueueService,
    ChatIngestQueueService,
    ChatIngestService,
    VoiceTranscribeQueueService,
    WorkChatService,
    InboxService,
    AccessLinkService,
    ExternalConversationService,
    ExternalGuestGuard,
  ],
})
export class MessagingModule {}
