import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiParticipantContext } from './prompts/participant-context';

@Injectable()
export class ParticipantContextService {
  private readonly logger = new Logger(ParticipantContextService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async loadForMeeting(meetingId: string): Promise<AiParticipantContext[]> {
    const participants = await this.prisma.participant.findMany({
      where: { meetingId },
      orderBy: [{ role: 'asc' }, { id: 'asc' }],
    });
    if (participants.length === 0) return [];

    const userIds = participants
      .map((p) => p.userId)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const result: AiParticipantContext[] = participants.map((p) => {
      const isHost = p.role === 'host';
      const user = p.userId ? (userById.get(p.userId) ?? null) : null;
      return {
        livekitIdentity: p.livekitIdentity,
        displayName: p.name,
        userId: p.isRegisteredUser && p.userId ? p.userId : null,
        fullName: user?.name ?? null,
        role: isHost ? 'host' : 'guest',
      };
    });
    return result;
  }
}
