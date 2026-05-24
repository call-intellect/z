import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * MyMentionsService — личный список @-упоминаний пользователя.
 *
 * T8 (2026-05-24): MVP-эндпоинт для бейджа «непрочитанные упоминания» в UI.
 * До этого момента mention'ы создавались (CommentsService) и эмитились через
 * Conversational, но прямого REST-доступа для UI не было. Это закрывает gap.
 *
 * Прочитанность — НЕ в IssueMention (там нет поля `readAt` и тикет запрещает
 * трогать schema.prisma). Источник истины статуса = `Notification`
 * (`eventType='issue.mention'`, ставится `status='read'` через
 * `ConversationalService.markRead`). Здесь мы только JOIN'им IssueMention с
 * последней Notification того же recipient'а + commentId/issueId, чтобы UI
 * показал «не прочитано» для тех, кому ещё не пришло ack-чтения.
 */
@Injectable()
export class MyMentionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Возвращает упоминания пользователя в задачах текущего tenant'а.
   * status='unread' → отфильтрованы те, у которых соответствующая
   * Notification(eventType='issue.mention') ещё не помечена 'read'/'responded'.
   * cursor — id последнего элемента предыдущей страницы.
   */
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
      /** `true` — есть Notification со status in (queued/sent/delivered). */
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

    // Подтянем статус нотификаций — group by commentId (хранится в payload).
    // Так как payload — Json, делаем простой findMany по recipient+eventType
    // в окне последних N упоминаний и сматчим в JS.
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
      const commentId =
        typeof payload.commentId === 'string' ? payload.commentId : null;
      if (!commentId) continue;
      // 'read' и 'responded' считаем прочитанными; всё прочее — нет.
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

    const filtered =
      args.status === 'unread' ? allItems.filter((i) => i.isUnread) : allItems;
    const hasMore = rows.length > limit;
    const trimmed = filtered.slice(0, limit);
    return {
      items: trimmed,
      nextCursor: hasMore ? rows[limit - 1]!.id : null,
    };
  }

  /** Подсчёт непрочитанных — для бейджа в шапке/sidebar. */
  async unreadCount(args: {
    userId: string;
    tenantId: string;
  }): Promise<{ unread: number }> {
    // Считаем по Notification — единый источник «не прочитано».
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
