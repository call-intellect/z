import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  InvalidFsmTransitionError,
  MeetingNotFoundError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LivekitService } from '../livekit/livekit.service';

/**
 * Сервис host-controls: mute/unmute, kick, lower-hand, finish.
 *
 * Все методы проверяют:
 *   1. Встреча существует.
 *   2. Действующий пользователь — owner встречи.
 *   3. Для mute/kick/lower-hand: meeting.status === 'active'.
 *   4. Для finish: meeting.status === 'active' (FSM сама проверит).
 *
 * Выполняемое действие в LiveKit + запись в `MeetingEvent` с типом
 * `host_action:<action>` для аудита.
 */
@Injectable()
export class HostControlsService {
  private readonly logger = new Logger(HostControlsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
  ) {}

  async muteParticipant(
    meetingId: string,
    participantId: string,
    hostUserId: string,
  ): Promise<void> {
    return this.runMuteAction(meetingId, participantId, hostUserId, true);
  }

  async unmuteParticipant(
    meetingId: string,
    participantId: string,
    hostUserId: string,
  ): Promise<void> {
    return this.runMuteAction(meetingId, participantId, hostUserId, false);
  }

  async kickParticipant(
    meetingId: string,
    participantId: string,
    hostUserId: string,
  ): Promise<void> {
    const { participant } = await this.assertHostAndActive(meetingId, hostUserId, participantId);

    await this.livekit.removeParticipant({ id: meetingId }, participant.livekitIdentity);
    await this.recordEvent(meetingId, 'host_action:kick', {
      participantId: participant.id,
      identity: participant.livekitIdentity,
    });
    this.logger.log({ meetingId, participantId }, 'Хост выкинул участника');
  }

  /**
   * Опустить чужую руку. Backend, потому что свою — frontend сам через
   * `livekit-client.setAttributes`. Атрибут `hand_raised` зарезервирован.
   */
  async lowerHand(
    meetingId: string,
    participantId: string,
    hostUserId: string,
  ): Promise<void> {
    const { participant } = await this.assertHostAndActive(meetingId, hostUserId, participantId);

    await this.livekit.updateParticipantAttributes(
      { id: meetingId },
      participant.livekitIdentity,
      { hand_raised: 'false', hand_raised_at: '' },
    );
    await this.recordEvent(meetingId, 'host_action:lower_hand', {
      participantId: participant.id,
      identity: participant.livekitIdentity,
    });
    this.logger.log({ meetingId, participantId }, 'Хост опустил руку');
  }

  /**
   * Завершить встречу. Удаляем LiveKit-room — webhook `room_finished`
   * довершит FSM-переход active → completed (см. LivekitEventsHandler).
   */
  async finish(meetingId: string, hostUserId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== hostUserId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    if (meeting.status !== 'active') {
      // FSM не разрешит active→completed из других статусов; здесь — явная ошибка
      // для UX (хост видит «нельзя завершить уже завершённую»).
      throw new InvalidFsmTransitionError(meeting.status, 'completed');
    }

    await this.livekit.deleteRoom({ id: meetingId });
    await this.recordEvent(meetingId, 'host_action:finish', { hostUserId });
    this.logger.log({ meetingId, hostUserId }, 'Хост запросил завершение встречи');
  }

  // ─────────────────────────── helpers ───────────────────────────────────

  private async runMuteAction(
    meetingId: string,
    participantId: string,
    hostUserId: string,
    mute: boolean,
  ): Promise<void> {
    const { participant } = await this.assertHostAndActive(meetingId, hostUserId, participantId);

    await this.livekit.muteParticipant({ id: meetingId }, participant.livekitIdentity, mute);
    await this.recordEvent(meetingId, mute ? 'host_action:mute' : 'host_action:unmute', {
      participantId: participant.id,
      identity: participant.livekitIdentity,
    });
    this.logger.log(
      { meetingId, participantId, mute },
      mute ? 'Хост замьютил участника' : 'Хост размьютил участника',
    );
  }

  /**
   * Общий guard:
   *   - встреча есть;
   *   - юзер — owner;
   *   - встреча в статусе active;
   *   - participant принадлежит этой встрече.
   */
  private async assertHostAndActive(
    meetingId: string,
    hostUserId: string,
    participantId: string,
  ): Promise<{
    meeting: { id: string; ownerId: string };
    participant: { id: string; meetingId: string; livekitIdentity: string };
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== hostUserId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    if (meeting.status !== 'active') {
      throw new InvalidFsmTransitionError(meeting.status, 'active');
    }

    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true, meetingId: true, livekitIdentity: true },
    });
    if (!participant || participant.meetingId !== meetingId) {
      throw new MeetingNotFoundError(participantId);
    }

    return { meeting: { id: meeting.id, ownerId: meeting.ownerId }, participant };
  }

  private async recordEvent(
    meetingId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.meetingEvent.create({
      data: {
        meetingId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
}
