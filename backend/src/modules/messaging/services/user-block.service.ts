import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { UserBlock } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class UserBlockService {
  private readonly logger = new Logger(UserBlockService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async blockInConversation(args: {
    tenantId: string;
    conversationId: string;
    blockerUserId: string;
    blockedUserId: string;
  }): Promise<UserBlock> {
    if (args.blockerUserId === args.blockedUserId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'CANNOT_BLOCK_SELF', message: 'Нельзя заблокировать себя' },
      });
    }

    const [blockerMember, blockedMember] = await Promise.all([
      this.prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: args.conversationId,
            userId: args.blockerUserId,
          },
        },
        select: { id: true },
      }),
      this.prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: args.conversationId,
            userId: args.blockedUserId,
          },
        },
        select: { id: true },
      }),
    ]);
    if (!blockerMember) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }
    if (!blockedMember) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'BLOCKED_NOT_MEMBER', message: 'Пользователь не участник этого разговора' },
      });
    }

    const block = await this.prisma.userBlock.upsert({
      where: {
        tenantId_blockerUserId_blockedUserId: {
          tenantId: args.tenantId,
          blockerUserId: args.blockerUserId,
          blockedUserId: args.blockedUserId,
        },
      },
      create: {
        tenantId: args.tenantId,
        blockerUserId: args.blockerUserId,
        blockedUserId: args.blockedUserId,
      },
      update: {},
    });
    this.logger.log(
      `blockInConversation: blocker=${args.blockerUserId} blocked=${args.blockedUserId} conv=${args.conversationId}`,
    );
    return block;
  }

  async isBlocked(args: {
    tenantId: string;
    authorUserId: string;
    recipientUserIds: string[];
  }): Promise<boolean> {
    if (args.recipientUserIds.length === 0) return false;
    const blocked = await this.prisma.userBlock.findFirst({
      where: {
        tenantId: args.tenantId,
        blockerUserId: { in: args.recipientUserIds },
        blockedUserId: args.authorUserId,
      },
      select: { id: true },
    });
    return blocked != null;
  }

  async isSendBlockedInConversation(args: {
    tenantId: string;
    conversationId: string;
    authorUserId: string;
  }): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { kind: true },
    });
    if (conversation?.kind !== 'dm') return false;

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: args.conversationId, userId: { not: args.authorUserId } },
      select: { userId: true },
    });
    return this.isBlocked({
      tenantId: args.tenantId,
      authorUserId: args.authorUserId,
      recipientUserIds: members.map((m) => m.userId),
    });
  }
}
