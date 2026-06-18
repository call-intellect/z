import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class MyMentionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: {
    userId: string;
    tenantId: string;
    status: 'unread' | 'all';
    limit: number;
    cursor: string | null;
  }): Promise<{
    items: Array<{
      id: string;
      issueId: string;
      issueIdentifier: string;
      issueTitle: string;
      commentId: string | null;
      mentionedByUserId: string;
      createdAt: string;
      isUnread: boolean;
    }>;
    nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(args.limit, 1), 100);
    const rows = await this.prisma.issueMention.findMany({
      where: {
        mentionedUserId: args.userId,
        issue: { tenantId: args.tenantId },
      },
      include: {
        issue: { select: { identifier: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return { items: [], nextCursor: null };

    const notifications = await this.prisma.notification.findMany({
      where: {
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        eventType: 'issue.mention',
        createdAt: { gte: rows[rows.length - 1]!.createdAt },
      },
      select: { payload: true, status: true },
    });
    const readCommentIds = new Set<string>();
    for (const n of notifications) {
      const payload = (n.payload ?? {}) as { commentId?: unknown };
      const commentId = typeof payload.commentId === 'string' ? payload.commentId : null;
      if (!commentId) continue;
      if (n.status === 'read' || n.status === 'responded') {
        readCommentIds.add(commentId);
      }
    }

    const allItems = rows.map((m) => ({
      id: m.id,
      issueId: m.issueId,
      issueIdentifier: m.issue.identifier,
      issueTitle: m.issue.title,
      commentId: m.commentId,
      mentionedByUserId: m.mentionedByUserId,
      createdAt: m.createdAt.toISOString(),
      isUnread: m.commentId ? !readCommentIds.has(m.commentId) : true,
    }));

    const filtered = args.status === 'unread' ? allItems.filter((i) => i.isUnread) : allItems;
    const hasMore = rows.length > limit;
    const trimmed = filtered.slice(0, limit);
    return {
      items: trimmed,
      nextCursor: hasMore ? rows[limit - 1]!.id : null,
    };
  }

  async unreadCount(args: { userId: string; tenantId: string }): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: {
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        eventType: 'issue.mention',
        status: { in: ['queued', 'sent_partial', 'delivered'] },
      },
    });
    return { unread };
  }
}
