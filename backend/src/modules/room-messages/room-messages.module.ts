import { Module } from '@nestjs/common';

import { MeetingMemberGuard } from './guards/meeting-member.guard';
import { RoomMessagesController } from './room-messages.controller';
import { RoomMessagesRepository } from './room-messages.repository';
import { RoomMessagesService } from './room-messages.service';

@Module({
  controllers: [RoomMessagesController],
  providers: [RoomMessagesService, RoomMessagesRepository, MeetingMemberGuard],
  exports: [RoomMessagesService],
})
export class RoomMessagesModule {}
