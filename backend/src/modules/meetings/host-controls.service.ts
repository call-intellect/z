import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MeetingStatus } from '@prisma/client';

import {
  InvalidFsmTransitionError,
  MeetingNotFoundError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LivekitService } from '../livekit/livekit.service';

import { assertTransition } from './fsm/meeting-fsm';

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

  async lowerHand(meetingId: string, participantId: string, hostUserId: string): Promise<void> {
    const { participant } = await this.assertHostAndActive(meetingId, hostUserId, participantId);

    await this.livekit.updateParticipantAttributes({ id: meetingId }, participant.livekitIdentity, {
      hand_raised: 'false',
      hand_raised_at: '',
    });
    await this.recordEvent(meetingId, 'host_action:lower_hand', {
      participantId: participant.id,
      identity: participant.livekitIdentity,
    });
    this.logger.log({ meetingId, participantId }, 'Хост опустил руку');
  }

  async finish(
    meetingId: string,
    hostUserId: string,
  ): Promise<{ status: MeetingStatus; failureReason: string | null }> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== hostUserId) {
      throw new NotAuthorizedError('not_meeting_host');
    }

    if (meeting.status === 'active') {
      await this.livekit.deleteRoom({ id: meetingId });
      await this.recordEvent(meetingId, 'host_action:finish', {
        hostUserId,
        fromStatus: 'active',
      });
      this.logger.log({ meetingId, hostUserId }, 'Хост запросил завершение активной встречи');
      return { status: meeting.status, failureReason: meeting.failureReason ?? null };
    }

    if (meeting.status === 'scheduled') {
      try {
        await this.livekit.deleteRoom({ id: meetingId });
      } catch (err) {
        this.logger.warn(
          { meetingId, err },
          'deleteRoom для scheduled-finish — best-effort (room могла не существовать)',
        );
      }
      assertTransition('scheduled', 'failed');
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'failed', failureReason: 'ended_before_start' },
      });
      await this.recordEvent(meetingId, 'host_action:finish', {
        hostUserId,
        fromStatus: 'scheduled',
        outcome: 'ended_before_start',
      });
      this.logger.log(
        { meetingId, hostUserId },
        'Завершение scheduled-встречи без записи (ended_before_start)',
      );
      return { status: 'failed', failureReason: 'ended_before_start' };
    }

    this.logger.log(
      { meetingId, status: meeting.status },
      'finish: встреча уже завершается/завершена — no-op',
    );
    return { status: meeting.status, failureReason: meeting.failureReason ?? null };
  }

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
