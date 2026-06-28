import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

interface MarkReadArgs {
  conversationId: string;
  userId: string;
  cursorSeq: bigint | string;
}

interface UnreadCountArgs {
  conversationId: string;
  userId: string;
}

@Injectable()
export class ReadCursorService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async markRead(args: MarkReadArgs): Promise<void> {
    const cursorSeq = BigInt(args.cursorSeq);
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: args.conversationId,
            userId: args.userId,
          },
        },
        select: { id: true, lastReadSeq: true },
      });
      if (!member) return;
      if (member.lastReadSeq >= cursorSeq) return;
      await tx.conversationMember.update({
        where: { id: member.id },
        data: { lastReadSeq: cursorSeq },
      });
    });
  }

  async getUnreadCount(args: UnreadCountArgs): Promise<number> {
    const [agg, member] = await Promise.all([
      this.prisma.message.aggregate({
        where: { conversationId: args.conversationId },
        _max: { seq: true },
      }),
      this.prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: args.conversationId,
            userId: args.userId,
          },
        },
        select: { lastReadSeq: true },
      }),
    ]);

    const maxSeq = agg._max.seq ?? 0n;
    const lastRead = member?.lastReadSeq ?? 0n;
    const unread = maxSeq - lastRead;
    return unread > 0n ? Number(unread) : 0;
  }
}
