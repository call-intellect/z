import { Module } from '@nestjs/common';

import { MeetingMemberGuard } from './guards/meeting-member.guard';
import { RoomMessagesController } from './room-messages.controller';
import { RoomMessagesRepository } from './room-messages.repository';
import { RoomMessagesService } from './room-messages.service';

/**
 * Модуль in-meeting room-chat.
 *
 * Зависит от глобальных:
 *   - `PrismaModule` — БД;
 *   - `AuthModule`   — `JwtService` для `MeetingMemberGuard` (читает `z_session`
 *     и `guest_session_<meetingId>` cookie).
 *
 * `ParticipantsService` импортируется только для статического метода
 * `guestCookieName(meetingId)` — DI не нужен.
 */
@Module({
  controllers: [RoomMessagesController],
  providers: [RoomMessagesService, RoomMessagesRepository, MeetingMemberGuard],
  exports: [RoomMessagesService],
})
export class RoomMessagesModule {}
