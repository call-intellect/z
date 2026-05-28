import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import {
  type ListRoomMessagesQuery,
  ListRoomMessagesQuerySchema,
} from './dto/list-room-messages.dto';
import {
  type SendRoomMessageDto,
  SendRoomMessageSchema,
} from './dto/send-room-message.dto';
import { MeetingMemberGuard } from './guards/meeting-member.guard';
import { RoomMessagesService } from './room-messages.service';

interface RoomMessageResponse {
  id: string;
  meetingId: string;
  participantId: string | null;
  authorName: string;
  authorIdentity: string;
  content: string;
  clientMessageId: string;
  sentAt: string;
}

/**
 * In-meeting chat REST API.
 *
 *   POST /api/v1/meetings/:meetingId/room-messages
 *     — идемпотентное сохранение по `clientMessageId`. Throttle 30/мин.
 *
 *   GET  /api/v1/meetings/:meetingId/room-messages?since=<ISO>
 *     — история (asc, до 1000), опц. фильтр по `since`.
 *
 * Доступ: владелец встречи или участник (host/registered/гость по
 * livekitIdentity). См. `MeetingMemberGuard`.
 */
@Controller('api/v1/meetings/:meetingId/room-messages')
@UseGuards(MeetingMemberGuard)
export class RoomMessagesController {
  constructor(
    @Inject(RoomMessagesService) private readonly service: RoomMessagesService,
  ) {}

  @Post()
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async send(
    @Param('meetingId') meetingId: string,
    @Body(new ZodValidationPipe(SendRoomMessageSchema)) body: SendRoomMessageDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<RoomMessageResponse> {
    const message = await this.service.send({
      meetingId,
      currentUser: user,
      clientMessageId: body.clientMessageId,
      content: body.content,
    });
    return this.mapMessage(message);
  }

  @Get()
  async list(
    @Param('meetingId') meetingId: string,
    @Query(new ZodValidationPipe(ListRoomMessagesQuerySchema))
    query: ListRoomMessagesQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: RoomMessageResponse[] }> {
    const items = await this.service.list({
      meetingId,
      currentUser: user,
      ...(query.since ? { since: new Date(query.since) } : {}),
    });
    return { items: items.map((m) => this.mapMessage(m)) };
  }

  private mapMessage(m: {
    id: string;
    meetingId: string;
    participantId: string | null;
    authorName: string;
    authorIdentity: string;
    content: string;
    clientMessageId: string;
    sentAt: Date;
  }): RoomMessageResponse {
    return {
      id: m.id,
      meetingId: m.meetingId,
      participantId: m.participantId,
      authorName: m.authorName,
      authorIdentity: m.authorIdentity,
      content: m.content,
      clientMessageId: m.clientMessageId,
      sentAt: m.sentAt.toISOString(),
    };
  }
}
