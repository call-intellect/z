import { Module } from '@nestjs/common';

import { ConversationController } from './conversation.controller';
import { AccessLinkService } from './external/access-link.service';
import { ExternalConversationController } from './external/external-conversation.controller';
import { ExternalConversationService } from './external/external-conversation.service';
import { ExternalGuestController } from './external/external-guest.controller';
import { ExternalGuestGuard } from './external/external-guest.guard';
import { MessageOutboxQueueService } from './queue/message-outbox.queue.service';
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { PresenceService } from './services/presence.service';
import { ReadCursorService } from './services/read-cursor.service';
import { WorkChatService } from './services/work-chat.service';

@Module({
  controllers: [ConversationController, ExternalConversationController, ExternalGuestController],
  providers: [
    ConversationService,
    MessageService,
    ReadCursorService,
    PresenceService,
    MessageOutboxQueueService,
    WorkChatService,
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
    WorkChatService,
    AccessLinkService,
    ExternalConversationService,
    ExternalGuestGuard,
  ],
})
export class MessagingModule {}
