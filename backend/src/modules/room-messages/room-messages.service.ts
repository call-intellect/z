import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MeetingRoomMessage } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import {
  ClientMessageIdCollisionError,
  NotMeetingParticipantError,
  RoomMessageTooLongError,
} from './exceptions/room-message-errors';
import { RoomMessagesRepository } from './room-messages.repository';

/**
 * Сохранение/чтение in-meeting room-chat сообщений.
 *
 * Идемпотентность POST'а — через `clientMessageId` (`@@unique`):
 * фронт может ретраить отправку без риска дубля.
 *
 * Ownership/участие: владелец встречи может писать всегда; иначе должен
 * быть Participant записан (через `userId` для зарегистрированных или
 * `livekitIdentity` для гостей).
 */
@Injectable()
export class RoomMessagesService {
  private readonly logger = new Logger(RoomMessagesService.name);

  constructor(
    @Inject(RoomMessagesRepository) private readonly repo: RoomMessagesRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async send(input: {
    meetingId: string;
    currentUser: CurrentUserPayload;
    clientMessageId: string;
    content: string;
  }): Promise<MeetingRoomMessage> {
    const { meetingId, currentUser, clientMessageId } = input;
    const content = input.content.trim();

    // 0. Бизнес-лимит на длину контента (жёсткий лимит DTO — на порядок выше).
    if (content.length === 0) {
      throw new RoomMessageTooLongError(this.cfg.workspace.maxRoomMessageChars);
    }
    if (content.length > this.cfg.workspace.maxRoomMessageChars) {
      throw new RoomMessageTooLongError(this.cfg.workspace.maxRoomMessageChars);
    }

    // 1. Идемпотентность.
    const existing = await this.repo.findByClientMessageId(clientMessageId);
    if (existing) {
      if (existing.meetingId !== meetingId) {
        throw new ClientMessageIdCollisionError();
      }
      return existing;
    }

    // 2. Встреча должна существовать и не быть soft-deleted.
    const meeting = await this.repo.findMeeting(meetingId);
    if (!meeting || meeting.deletedAt !== null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }

    // 3. Проверка участия: либо owner встречи, либо Participant в неё.
    const isOwner =
      currentUser.id !== '' && currentUser.id === meeting.ownerId;
    const participant = await this.repo.findParticipant({
      meetingId,
      ...(currentUser.id ? { userId: currentUser.id } : {}),
      ...(currentUser.livekitIdentity
        ? { livekitIdentity: currentUser.livekitIdentity }
        : {}),
    });

    if (!isOwner && !participant) {
      throw new NotMeetingParticipantError();
    }

    // 4. Денормализация автора. Приоритет: участие → текущий юзер → fallback.
    const authorName =
      participant?.name ?? currentUser.name ?? currentUser.email ?? 'Участник';
    const authorIdentity =
      participant?.livekitIdentity ??
      currentUser.livekitIdentity ??
      (currentUser.id ? `user:${currentUser.id}` : 'unknown');

    const message = await this.repo.create({
      meetingId,
      participantId: participant?.id ?? null,
      authorName,
      authorIdentity,
      content,
      clientMessageId,
    });

    this.logger.log(
      `room-message created meeting=${meetingId} participant=${participant?.id ?? 'owner'} bytes=${content.length}`,
    );
    return message;
  }

  async list(input: {
    meetingId: string;
    currentUser: CurrentUserPayload;
    since?: Date;
  }): Promise<MeetingRoomMessage[]> {
    const { meetingId, currentUser, since } = input;

    const meeting = await this.repo.findMeeting(meetingId);
    if (!meeting || meeting.deletedAt !== null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }

    const isOwner =
      currentUser.id !== '' && currentUser.id === meeting.ownerId;
    const participant = await this.repo.findParticipant({
      meetingId,
      ...(currentUser.id ? { userId: currentUser.id } : {}),
      ...(currentUser.livekitIdentity
        ? { livekitIdentity: currentUser.livekitIdentity }
        : {}),
    });
    if (!isOwner && !participant) {
      throw new NotMeetingParticipantError();
    }

    return this.repo.list(meetingId, since ? { since } : {});
  }
}
