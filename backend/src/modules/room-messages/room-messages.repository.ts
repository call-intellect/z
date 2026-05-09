import { Inject, Injectable } from '@nestjs/common';
import { type Meeting, type MeetingRoomMessage, type Participant } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/** Жёсткий потолок выдачи истории — защита от перебора. */
const HISTORY_LIMIT = 1_000;

@Injectable()
export class RoomMessagesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByClientMessageId(clientMessageId: string): Promise<MeetingRoomMessage | null> {
    return this.prisma.meetingRoomMessage.findUnique({
      where: { clientMessageId },
    });
  }

  findMeeting(meetingId: string): Promise<Meeting | null> {
    return this.prisma.meeting.findUnique({ where: { id: meetingId } });
  }

  /**
   * Найти Participant'а в рамках встречи. Сначала по `userId` (зарегистрированный
   * юзер / host), затем по `livekitIdentity` (гость без userId).
   * Возвращает первого подходящего или null.
   */
  async findParticipant(args: {
    meetingId: string;
    userId?: string;
    livekitIdentity?: string;
  }): Promise<Participant | null> {
    if (args.userId) {
      const byUser = await this.prisma.participant.findFirst({
        where: { meetingId: args.meetingId, userId: args.userId },
      });
      if (byUser) return byUser;
    }
    if (args.livekitIdentity) {
      const byIdentity = await this.prisma.participant.findUnique({
        where: {
          meetingId_livekitIdentity: {
            meetingId: args.meetingId,
            livekitIdentity: args.livekitIdentity,
          },
        },
      });
      if (byIdentity) return byIdentity;
    }
    return null;
  }

  create(data: {
    meetingId: string;
    participantId: string | null;
    authorName: string;
    authorIdentity: string;
    content: string;
    clientMessageId: string;
  }): Promise<MeetingRoomMessage> {
    return this.prisma.meetingRoomMessage.create({ data });
  }

  list(
    meetingId: string,
    opts: { since?: Date } = {},
  ): Promise<MeetingRoomMessage[]> {
    return this.prisma.meetingRoomMessage.findMany({
      where: {
        meetingId,
        ...(opts.since ? { sentAt: { gt: opts.since } } : {}),
      },
      orderBy: { sentAt: 'asc' },
      take: HISTORY_LIMIT,
    });
  }
}
