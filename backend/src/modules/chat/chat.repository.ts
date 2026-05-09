import { Inject, Injectable } from '@nestjs/common';
import type { ChatRole, MeetingChatMessage, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ChatRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listMeetingHistory(input: {
    userId: string;
    meetingId: string;
    limit?: number;
  }): Promise<MeetingChatMessage[]> {
    return this.prisma.meetingChatMessage.findMany({
      where: { userId: input.userId, meetingId: input.meetingId },
      orderBy: { createdAt: 'asc' },
      take: input.limit ?? 200,
    });
  }

  listCrossHistory(input: {
    userId: string;
    limit?: number;
  }): Promise<MeetingChatMessage[]> {
    return this.prisma.meetingChatMessage.findMany({
      where: { userId: input.userId, meetingId: null, cardId: null },
      orderBy: { createdAt: 'asc' },
      take: input.limit ?? 200,
    });
  }

  listCardHistory(input: {
    userId: string;
    cardId: string;
    limit?: number;
  }): Promise<MeetingChatMessage[]> {
    return this.prisma.meetingChatMessage.findMany({
      where: { userId: input.userId, cardId: input.cardId },
      orderBy: { createdAt: 'asc' },
      take: input.limit ?? 200,
    });
  }

  appendMessage(input: {
    userId: string;
    meetingId: string | null;
    cardId?: string | null;
    role: ChatRole;
    content: string;
    citations?: unknown;
    tokensIn?: number;
    tokensOut?: number;
    modelUsed?: string;
  }): Promise<MeetingChatMessage> {
    return this.prisma.meetingChatMessage.create({
      data: {
        userId: input.userId,
        meetingId: input.meetingId,
        cardId: input.cardId ?? null,
        role: input.role,
        content: input.content,
        ...(input.citations !== undefined
          ? { citations: input.citations as Prisma.InputJsonValue }
          : {}),
        ...(input.tokensIn !== undefined ? { tokensIn: input.tokensIn } : {}),
        ...(input.tokensOut !== undefined ? { tokensOut: input.tokensOut } : {}),
        ...(input.modelUsed !== undefined ? { modelUsed: input.modelUsed } : {}),
      },
    });
  }
}
