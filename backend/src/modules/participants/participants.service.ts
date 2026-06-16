import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Meeting } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../common/config/index';
import {
  GuestNameRequiredError,
  MeetingFinishedError,
  MeetingNotFoundError,
} from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';
import { LivekitService } from '../livekit/livekit.service';

export interface JoinResult {
  participantId: string;
  role: 'host' | 'guest';
  livekitIdentity: string;
  livekit: {
    url: string;
    token: string;
    identity: string;
  };
  guestSessionCookie?: {
    name: string;
    value: string;
    maxAgeSeconds: number;
  };
}

const GUEST_NAME_MAX_LENGTH = 80;
const XSS_UNSAFE_CHARS = /[<>&"'/]/g;

@Injectable()
export class ParticipantsService {
  private readonly logger = new Logger(ParticipantsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
  ) {}

  static guestCookieName(meetingId: string): string {
    return `guest_session_${meetingId}`;
  }

  static sanitizeGuestName(input: string): string | null {
    const stripped = input.replace(XSS_UNSAFE_CHARS, '').trim();
    if (stripped.length === 0) return null;
    return stripped.slice(0, GUEST_NAME_MAX_LENGTH);
  }

  async join(input: {
    meetingId: string;
    userId: string | null;
    guestName: string | null;
    existingGuestCookie: string | null;
    inviteToken: string | null;
  }): Promise<JoinResult> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
    });
    if (!meeting) throw new MeetingNotFoundError(input.meetingId);
    this.assertJoinable(meeting);

    if (input.inviteToken) {
      const invited = await this.prisma.participant.findUnique({
        where: { inviteToken: input.inviteToken },
      });
      if (invited && invited.meetingId === meeting.id) {
        return this.joinAsInvited(meeting, invited);
      }
    }

    if (input.userId && meeting.ownerId === input.userId) {
      return this.joinAsHost(meeting, input.userId);
    }

    if (input.userId) {
      const persons = await this.prisma.person.findMany({
        where: {
          userId: input.userId,
          ...(meeting.tenantId ? { tenantId: meeting.tenantId } : {}),
        },
        select: { id: true },
      });
      const personIds = persons.map((p) => p.id);
      const preSeeded = await this.prisma.participant.findFirst({
        where: {
          meetingId: meeting.id,
          invitationStatus: 'invited',
          OR: [
            { userId: input.userId },
            ...(personIds.length > 0 ? [{ personId: { in: personIds } }] : []),
          ],
        },
      });
      if (preSeeded) {
        return this.joinAsInvited(meeting, preSeeded);
      }
    }

    return this.joinAsGuest(meeting, input.guestName, input.existingGuestCookie);
  }

  private async joinAsInvited(
    meeting: Meeting,
    participant: { id: string; livekitIdentity: string; name: string; role: 'host' | 'guest' },
  ): Promise<JoinResult> {
    await this.livekit.ensureRoom({ id: meeting.id });
    const token = await this.livekit.generateGuestToken(
      { id: meeting.id, endedAt: meeting.endedAt },
      participant.livekitIdentity,
      participant.name,
    );

    await this.prisma.participant.update({
      where: { id: participant.id },
      data: { invitationStatus: 'joined', joinedAt: new Date() },
    });

    return {
      participantId: participant.id,
      role: participant.role,
      livekitIdentity: participant.livekitIdentity,
      livekit: {
        url: this.cfg.livekit.apiUrl,
        token,
        identity: participant.livekitIdentity,
      },
    };
  }

  private async joinAsHost(meeting: Meeting, userId: string): Promise<JoinResult> {
    const livekitIdentity = `host:${userId}`;
    let participant = await this.prisma.participant.findUnique({
      where: {
        meetingId_livekitIdentity: {
          meetingId: meeting.id,
          livekitIdentity,
        },
      },
    });

    if (!participant) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      participant = await this.prisma.participant.create({
        data: {
          meetingId: meeting.id,
          livekitIdentity,
          name: user?.name ?? 'Host',
          role: 'host',
          isRegisteredUser: true,
          userId,
        },
      });
      this.logger.log(`Создан host-Participant ${participant.id} для встречи ${meeting.id}`);
    }

    await this.livekit.ensureRoom({ id: meeting.id });
    const token = await this.livekit.generateHostToken(
      { id: meeting.id, endedAt: meeting.endedAt },
      livekitIdentity,
      participant.name,
    );

    return {
      participantId: participant.id,
      role: 'host',
      livekitIdentity,
      livekit: {
        url: this.cfg.livekit.apiUrl,
        token,
        identity: livekitIdentity,
      },
    };
  }

  private async joinAsGuest(
    meeting: Meeting,
    rawGuestName: string | null,
    existingGuestCookie: string | null,
  ): Promise<JoinResult> {
    if (existingGuestCookie) {
      try {
        const payload = this.jwt.verifyGuestSession(existingGuestCookie);
        if (payload.meetingId === meeting.id) {
          const existing = await this.prisma.participant.findUnique({
            where: { id: payload.participantId },
          });
          if (existing && existing.meetingId === meeting.id && existing.role === 'guest') {
            await this.livekit.ensureRoom({ id: meeting.id });
            const token = await this.livekit.generateGuestToken(
              { id: meeting.id, endedAt: meeting.endedAt },
              existing.livekitIdentity,
              existing.name,
            );
            return {
              participantId: existing.id,
              role: 'guest',
              livekitIdentity: existing.livekitIdentity,
              livekit: {
                url: this.cfg.livekit.apiUrl,
                token,
                identity: existing.livekitIdentity,
              },
            };
          }
        }
      } catch {}
    }

    if (!rawGuestName) {
      throw new GuestNameRequiredError();
    }
    const cleanName = ParticipantsService.sanitizeGuestName(rawGuestName);
    if (!cleanName) {
      throw new GuestNameRequiredError();
    }

    const guestId = nanoid();
    const livekitIdentity = `guest:${guestId}`;
    const participant = await this.prisma.participant.create({
      data: {
        meetingId: meeting.id,
        livekitIdentity,
        name: cleanName,
        role: 'guest',
        isRegisteredUser: false,
      },
    });

    const cookieValue = this.jwt.signGuestSession({
      participantId: participant.id,
      meetingId: meeting.id,
    });

    await this.livekit.ensureRoom({ id: meeting.id });
    const token = await this.livekit.generateGuestToken(
      { id: meeting.id, endedAt: meeting.endedAt },
      livekitIdentity,
      participant.name,
    );

    return {
      participantId: participant.id,
      role: 'guest',
      livekitIdentity,
      livekit: {
        url: this.cfg.livekit.apiUrl,
        token,
        identity: livekitIdentity,
      },
      guestSessionCookie: {
        name: ParticipantsService.guestCookieName(meeting.id),
        value: cookieValue,
        maxAgeSeconds: this.jwt.guestSessionTtlSeconds,
      },
    };
  }

  private assertJoinable(meeting: Meeting): void {
    if (meeting.status === 'failed') {
      throw new MeetingFinishedError();
    }
    if (meeting.status !== 'scheduled' && meeting.status !== 'active' && meeting.endedAt) {
      const oneHourMs = 60 * 60 * 1000;
      if (Date.now() - meeting.endedAt.getTime() > oneHourMs) {
        throw new MeetingFinishedError();
      }
    }
  }
}
