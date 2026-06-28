import { Module } from '@nestjs/common';

import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { ReadCursorService } from './services/read-cursor.service';

@Module({
  providers: [ConversationService, MessageService, ReadCursorService],
  exports: [ConversationService, MessageService, ReadCursorService],
})
export class MessagingModule {}
