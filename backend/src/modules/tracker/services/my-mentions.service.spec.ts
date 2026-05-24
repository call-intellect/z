import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { MyMentionsService } from './my-mentions.service';

/**
 * T8 (2026-05-24) — unit-тесты MyMentionsService.
 *
 * Покрытие:
 *  1. list (unread) — фильтрует по tenantId + только те, у которых
 *     соответствующая Notification(eventType='issue.mention') не в read/responded.
 *  2. list (all) — возвращает все, помечая прочитанные.
 *  3. unreadCount — корректно считает Notification.
 */

interface MentionRow {
  id: string;
  issueId: string;
  commentId: string | null;
  mentionedUserId: string;
  mentionedByUserId: string;
  createdAt: Date;
  issue: { tenantId: string; identifier: string; title: string };
}

interface NotificationRow {
  payload: { commentId?: string };
  status: string;
  recipientUserId: string;
  tenantId: string;
  eventType: string;
}

function makePrismaMock(
  mentions: MentionRow[],
  notifications: NotificationRow[],
): PrismaService {
  return {
    issueMention: {
      findMany: vi.fn(async (args: {
        where: { mentionedUserId: string; issue: { tenantId: string } };
        take: number;
      }) => {
        const filtered = mentions
          .filter(
            (m) =>
              m.mentionedUserId === args.where.mentionedUserId &&
              m.issue.tenantId === args.where.issue.tenantId,
          )
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return filtered.slice(0, args.take);
      }),
    },
    notification: {
      findMany: vi.fn(async (args: {
        where: {
          tenantId: string;
          recipientUserId: string;
          eventType: string;
        };
      }) =>
        notifications.filter(
          (n) =>
            n.tenantId === args.where.tenantId &&
            n.recipientUserId === args.where.recipientUserId &&
            n.eventType === args.where.eventType,
        ),
      ),
      count: vi.fn(async (args: {
        where: {
          tenantId: string;
          recipientUserId: string;
          eventType: string;
          status: { in: string[] };
        };
      }) =>
        notifications.filter(
          (n) =>
            n.tenantId === args.where.tenantId &&
            n.recipientUserId === args.where.recipientUserId &&
            n.eventType === args.where.eventType &&
            args.where.status.in.includes(n.status),
        ).length,
      ),
    },
  } as unknown as PrismaService;
}

describe('MyMentionsService', () => {
  const TENANT = 'tenant-1';
  const USER = 'user-1';
  let mentions: MentionRow[];
  let notifications: NotificationRow[];
  let svc: MyMentionsService;

  beforeEach(() => {
    mentions = [
      {
        id: 'm1',
        issueId: 'i1',
        commentId: 'c1',
        mentionedUserId: USER,
        mentionedByUserId: 'user-2',
        createdAt: new Date('2026-05-23T10:00:00Z'),
        issue: { tenantId: TENANT, identifier: 'PRJ-1', title: 'Задача один' },
      },
      {
        id: 'm2',
        issueId: 'i2',
        commentId: 'c2',
        mentionedUserId: USER,
        mentionedByUserId: 'user-3',
        createdAt: new Date('2026-05-22T10:00:00Z'),
        issue: { tenantId: TENANT, identifier: 'PRJ-2', title: 'Задача два' },
      },
      {
        id: 'm3',
        issueId: 'i3',
        commentId: 'c3',
        mentionedUserId: USER,
        mentionedByUserId: 'user-2',
        createdAt: new Date('2026-05-24T10:00:00Z'),
        issue: {
          tenantId: 'tenant-2',
          identifier: 'OTHER-1',
          title: 'Чужой tenant',
        },
      },
    ];
    notifications = [
      // c2 уже прочитан
      {
        payload: { commentId: 'c2' },
        status: 'read',
        recipientUserId: USER,
        tenantId: TENANT,
        eventType: 'issue.mention',
      },
      // c1 ещё в очереди — не прочитан
      {
        payload: { commentId: 'c1' },
        status: 'delivered',
        recipientUserId: USER,
        tenantId: TENANT,
        eventType: 'issue.mention',
      },
    ];
    svc = new MyMentionsService(makePrismaMock(mentions, notifications));
  });

  it('list(unread) возвращает только непрочитанные в tenant\'е', async () => {
    const res = await svc.list({
      userId: USER,
      tenantId: TENANT,
      status: 'unread',
      limit: 50,
      cursor: null,
    });
    // m3 в другом tenant'е (фильтр в where), m2 — прочитан, остаётся m1.
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.id).toBe('m1');
    expect(res.items[0]!.issueIdentifier).toBe('PRJ-1');
    expect(res.items[0]!.isUnread).toBe(true);
  });

  it('list(all) возвращает все, помечая isUnread', async () => {
    const res = await svc.list({
      userId: USER,
      tenantId: TENANT,
      status: 'all',
      limit: 50,
      cursor: null,
    });
    expect(res.items).toHaveLength(2);
    const m2 = res.items.find((i) => i.id === 'm2');
    expect(m2?.isUnread).toBe(false);
  });

  it('unreadCount считает Notification по delivered/queued', async () => {
    const res = await svc.unreadCount({ userId: USER, tenantId: TENANT });
    expect(res.unread).toBe(1);
  });
});
