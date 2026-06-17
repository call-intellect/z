import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ConciergeAnalyticsService } from './concierge-analytics.service';

interface MessageRow {
  id: string;
  conversationId: string;
  content: string;
  createdAt: Date;
  role: 'user' | 'assistant' | 'tool';
}

function buildPrismaMock(opts: {
  messages?: MessageRow[];
  conversations?: Array<{
    id: string;
    tenantId: string;
    userId: string;
    lastMessageAt: Date | null;
  }>;
  users?: Array<{ id: string; email: string | null }>;
  noMessageModel?: boolean;
}): PrismaService {
  const messages = opts.messages ?? [];
  const conversations = opts.conversations ?? [];
  const users = opts.users ?? [];

  const conciergeMessage = opts.noMessageModel
    ? undefined
    : {
        count: vi
          .fn()
          .mockImplementation(
            ({ where }: { where: { role: string; createdAt: { gte: Date; lt: Date } } }) => {
              const filtered = messages.filter(
                (m) =>
                  m.role === where.role &&
                  m.createdAt >= where.createdAt.gte &&
                  m.createdAt < where.createdAt.lt,
              );
              return Promise.resolve(filtered.length);
            },
          ),
        findMany: vi.fn().mockImplementation(
          (args: {
            where: {
              role: string;
              createdAt: { gte: Date; lt: Date };
              conversationId?: string;
            };
            orderBy?: { createdAt: 'desc' | 'asc' };
            take?: number;
            skip?: number;
          }) => {
            let filtered = messages.filter(
              (m) =>
                m.role === args.where.role &&
                m.createdAt >= args.where.createdAt.gte &&
                m.createdAt < args.where.createdAt.lt,
            );
            if (args.where.conversationId) {
              filtered = filtered.filter((m) => m.conversationId === args.where.conversationId);
            }
            if (args.orderBy?.createdAt === 'desc') {
              filtered = [...filtered].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              );
            }
            const skip = args.skip ?? 0;
            const take = args.take ?? filtered.length;
            return Promise.resolve(filtered.slice(skip, skip + take));
          },
        ),
        findFirst: vi.fn().mockImplementation(
          (args: {
            where: {
              conversationId: string;
              role: string;
              createdAt: { lt: Date };
            };
            orderBy: { createdAt: 'desc' };
          }) => {
            const filtered = messages
              .filter(
                (m) =>
                  m.conversationId === args.where.conversationId &&
                  m.role === args.where.role &&
                  m.createdAt < args.where.createdAt.lt,
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return Promise.resolve(filtered[0] ?? null);
          },
        ),
      };

  const conciergeConversation = opts.noMessageModel
    ? undefined
    : {
        groupBy: vi
          .fn()
          .mockImplementation(
            ({ where }: { where: { lastMessageAt: { gte: Date; lt: Date } } }) => {
              const filtered = conversations.filter(
                (c) =>
                  c.lastMessageAt !== null &&
                  c.lastMessageAt >= where.lastMessageAt.gte &&
                  c.lastMessageAt < where.lastMessageAt.lt,
              );
              const unique = Array.from(new Set(filtered.map((c) => c.userId)));
              return Promise.resolve(unique.map((userId) => ({ userId })));
            },
          ),
        findMany: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) => {
          return Promise.resolve(conversations.filter((c) => where.id.in.includes(c.id)));
        }),
      };

  const user = {
    findMany: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) => {
      return Promise.resolve(users.filter((u) => where.id.in.includes(u.id)));
    }),
  };

  const base: Record<string, unknown> = { user };
  if (conciergeMessage) base['conciergeMessage'] = conciergeMessage;
  if (conciergeConversation) base['conciergeConversation'] = conciergeConversation;
  return base as unknown as PrismaService;
}

describe('ConciergeAnalyticsService', () => {
  const NOW = new Date('2026-05-25T12:00:00Z');
  const DAY_AGO = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
  const SIX_DAYS_AGO = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isAvailable()=false когда модели нет в Prisma client', () => {
    const prisma = buildPrismaMock({ noMessageModel: true });
    const svc = new ConciergeAnalyticsService(prisma);
    expect(svc.isAvailable()).toBe(false);
  });

  it('getOverview() возвращает нули + null-rate, если модели нет', async () => {
    const prisma = buildPrismaMock({ noMessageModel: true });
    const svc = new ConciergeAnalyticsService(prisma);
    const overview = await svc.getOverview('week');
    expect(overview.totalQuestions).toBe(0);
    expect(overview.noAnswerRate).toBeNull();
    expect(overview.activeUsers).toBe(0);
    expect(overview.notes.avgLatencyAvailable).toBe(false);
  });

  it('getOverview() считает totals и no-answer-rate (эвристика по маркерам)', async () => {
    const prisma = buildPrismaMock({
      messages: [
        {
          id: 'u1',
          conversationId: 'c1',
          content: 'Как создать встречу?',
          createdAt: DAY_AGO,
          role: 'user',
        },
        {
          id: 'u2',
          conversationId: 'c1',
          content: 'А отчёт где?',
          createdAt: DAY_AGO,
          role: 'user',
        },
        {
          id: 'u3',
          conversationId: 'c2',
          content: 'Сколько участников?',
          createdAt: SIX_DAYS_AGO,
          role: 'user',
        },
        {
          id: 'a1',
          conversationId: 'c1',
          content: 'Перейдите в раздел встречи и нажмите...',
          createdAt: DAY_AGO,
          role: 'assistant',
        },
        {
          id: 'a2',
          conversationId: 'c1',
          content: 'К сожалению, я не нашёл информации.',
          createdAt: DAY_AGO,
          role: 'assistant',
        },
      ],
      conversations: [
        { id: 'c1', tenantId: 't1', userId: 'user1', lastMessageAt: DAY_AGO },
        { id: 'c2', tenantId: 't1', userId: 'user2', lastMessageAt: SIX_DAYS_AGO },
      ],
    });
    const svc = new ConciergeAnalyticsService(prisma);

    const overview = await svc.getOverview('week');
    expect(overview.totalQuestions).toBe(3);
    expect(overview.activeUsers).toBe(2);
    expect(overview.noAnswerRate).toBe(0.5);
    expect(overview.notes.noAnswerRateIsHeuristic).toBe(true);
  });

  it('getOverview() noAnswerRate=null если за период нет assistant-сообщений', async () => {
    const prisma = buildPrismaMock({
      messages: [
        { id: 'u1', conversationId: 'c1', content: 'Привет', createdAt: DAY_AGO, role: 'user' },
      ],
      conversations: [{ id: 'c1', tenantId: 't1', userId: 'user1', lastMessageAt: DAY_AGO }],
    });
    const svc = new ConciergeAnalyticsService(prisma);
    const overview = await svc.getOverview('week');
    expect(overview.totalQuestions).toBe(1);
    expect(overview.noAnswerRate).toBeNull();
  });

  it('getTopQueries() нормализует content (lowercase + trim) и считает частоты', async () => {
    const prisma = buildPrismaMock({
      messages: [
        {
          id: 'u1',
          conversationId: 'c1',
          content: 'Как создать встречу?',
          createdAt: DAY_AGO,
          role: 'user',
        },
        {
          id: 'u2',
          conversationId: 'c2',
          content: '  как создать ВСТРЕЧУ?  ',
          createdAt: DAY_AGO,
          role: 'user',
        },
        { id: 'u3', conversationId: 'c3', content: 'Где отчёт?', createdAt: DAY_AGO, role: 'user' },
        { id: 'u4', conversationId: 'c4', content: 'ab', createdAt: DAY_AGO, role: 'user' },
      ],
    });
    const svc = new ConciergeAnalyticsService(prisma);

    const top = await svc.getTopQueries('week', 10);
    expect(top.length).toBe(2);
    expect(top[0]).toEqual({ query: 'как создать встречу?', count: 2 });
    expect(top[1]).toEqual({ query: 'где отчёт?', count: 1 });
  });

  it('getTopQueries() пустой, если модели нет', async () => {
    const prisma = buildPrismaMock({ noMessageModel: true });
    const svc = new ConciergeAnalyticsService(prisma);
    const top = await svc.getTopQueries('week', 10);
    expect(top).toEqual([]);
  });

  it('getNoAnswerList() находит assistant с маркерами и подгружает предыдущий user-вопрос', async () => {
    const ANSWER_TIME = DAY_AGO;
    const QUESTION_TIME = new Date(ANSWER_TIME.getTime() - 60_000);
    const prisma = buildPrismaMock({
      messages: [
        {
          id: 'u1',
          conversationId: 'c1',
          content: 'Где найти регламент?',
          createdAt: QUESTION_TIME,
          role: 'user',
        },
        {
          id: 'a1',
          conversationId: 'c1',
          content: 'К сожалению, я не нашёл такого регламента.',
          createdAt: ANSWER_TIME,
          role: 'assistant',
        },
        {
          id: 'a2',
          conversationId: 'c2',
          content: 'Вот регламент: ...',
          createdAt: ANSWER_TIME,
          role: 'assistant',
        },
      ],
      conversations: [
        { id: 'c1', tenantId: 't1', userId: 'user1', lastMessageAt: ANSWER_TIME },
        { id: 'c2', tenantId: 't1', userId: 'user2', lastMessageAt: ANSWER_TIME },
      ],
      users: [
        { id: 'user1', email: 'one@example.com' },
        { id: 'user2', email: 'two@example.com' },
      ],
    });
    const svc = new ConciergeAnalyticsService(prisma);

    const list = await svc.getNoAnswerList('week', 50);
    expect(list).toHaveLength(1);
    expect(list[0]?.messageId).toBe('a1');
    expect(list[0]?.tenantId).toBe('t1');
    expect(list[0]?.userId).toBe('user1');
    expect(list[0]?.userEmail).toBe('one@example.com');
    expect(list[0]?.query).toBe('Где найти регламент?');
  });

  it('getNoAnswerList() пустой, если модели нет', async () => {
    const prisma = buildPrismaMock({ noMessageModel: true });
    const svc = new ConciergeAnalyticsService(prisma);
    const list = await svc.getNoAnswerList('week', 50);
    expect(list).toEqual([]);
  });
});
