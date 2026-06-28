import { Module } from '@nestjs/common';

import { MessageOutboxQueueService } from './queue/message-outbox.queue.service';
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { PresenceService } from './services/presence.service';
import { ReadCursorService } from './services/read-cursor.service';

@Module({
  providers: [
    ConversationService,
    MessageService,
    ReadCursorService,
    PresenceService,
    MessageOutboxQueueService,
  ],
  exports: [
    ConversationService,
    MessageService,
    ReadCursorService,
    PresenceService,
    MessageOutboxQueueService,
  ],
})
export class MessagingModule {}
