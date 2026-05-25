/**
 * Unit-тесты для FeedbackService (пользовательская часть + admin-методы).
 *
 * Покрытие user-части (Фаза 2):
 *   - submit: создаёт FeedbackMessage с правильными полями (trim, orgId, defaults)
 *   - listMine: возвращает items + total + пагинация, сортировка createdAt desc
 *   - getLimit: читает Redis-ключ (UTC, формат feedback:ratelimit:{uid}:{YYYY-MM-DD})
 *               возвращает usedToday / limit=5 / resetAt в виде ISO полночи UTC
 *
 * Покрытие admin-части (Фаза 6):
 *   - listFailedMessages: фильтр failedRuns>=3 AND processedAt IS NULL,
 *                         сортировка failedRuns desc, маппинг userEmail
 *   - listTopics/getTopicDetails/getTopicItems/getMessageById: фасадные
 *     методы тонко делегируют в FeedbackTopicManagerService (подробные
 *     тесты — в feedback-topic-manager.service.spec.ts).
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import type { FeedbackTopicManagerService } from './feedback-topic-manager.service';
import { FeedbackService } from './feedback.service';

interface PrismaStub {
  prisma: PrismaService;
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}

interface RedisStub {
  redis: RedisService;
  get: ReturnType<typeof vi.fn>;
}

function makePrisma(opts: {
  createReturn?: unknown;
  findManyReturn?: unknown[];
  countReturn?: number;
} = {}): PrismaStub {
  const create = vi.fn(async () => opts.createReturn);
  const findMany = vi.fn(async () => opts.findManyReturn ?? []);
  const count = vi.fn(async () => opts.countReturn ?? 0);

  const prisma = {
    feedbackMessage: { create, findMany, count },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;

  return { prisma, create, findMany, count };
}

function makeRedis(getReturn: string | null = null): RedisStub {
  const get = vi.fn(async () => getReturn);
  const redis = { client: { get } } as unknown as RedisService;
  return { redis, get };
}

/**
 * Заглушка FeedbackTopicManagerService — методы возвращают vi.fn(),
 * чтобы тесты могли проверить вызов фасадными методами FeedbackService.
 */
function makeTopicManager(): {
  manager: FeedbackTopicManagerService;
  listTopics: ReturnType<typeof vi.fn>;
  getTopic: ReturnType<typeof vi.fn>;
  listItems: ReturnType<typeof vi.fn>;
  getItemMessage: ReturnType<typeof vi.fn>;
} {
  const listTopics = vi.fn(async () => ({
    items: [],
    totalItemsInWindow: 0,
    totalUsersInWindow: 0,
    totalTopicsInWindow: 0,
    page: 1,
    pageSize: 20,
  }));
  const getTopic = vi.fn(async () => ({
    id: 't-1',
    title: 't',
    description: 'd',
    status: 'ACTIVE',
    itemsCount: 0,
    uniqueUsersCount: 0,
    percentOfWindow: 0,
    lastItemAt: null,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    updatedAt: new Date().toISOString(),
    mergedIntoId: null,
  }));
  const listItems = vi.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  }));
  const getItemMessage = vi.fn(async () => ({
    id: 'm-1',
    text: 'x',
    createdAt: new Date().toISOString(),
    userId: 'u-1',
    orgId: null,
    user: { id: 'u-1', email: 'a@b', name: null },
    org: null,
  }));
  const manager = {
    listTopics,
    getTopic,
    listItems,
    getItemMessage,
  } as unknown as FeedbackTopicManagerService;
  return { manager, listTopics, getTopic, listItems, getItemMessage };
}

describe('FeedbackService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-05-25 12:34:56 UTC
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 25, 12, 34, 56)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('submit', () => {
    it('создаёт FeedbackMessage с trim, userId, orgId; возвращает DTO с ISO-датами', async () => {
      const createdAt = new Date(Date.UTC(2026, 4, 25, 10, 0, 0));
      const prismaStub = makePrisma({
        createReturn: {
          id: 'fm-1',
          text: 'Хочу больше отчётов',
          createdAt,
          processedAt: null,
        },
      });
      const redisStub = makeRedis();

      const svc = new FeedbackService(
        prismaStub.prisma,
        redisStub.redis,
        makeTopicManager().manager,
      );
      const result = await svc.submit(
        'u-1',
        'org-42',
        '  Хочу больше отчётов  ',
      );

      expect(prismaStub.create).toHaveBeenCalledTimes(1);
      expect(prismaStub.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          orgId: 'org-42',
          text: 'Хочу больше отчётов',
        },
        select: {
          id: true,
          text: true,
          createdAt: true,
          processedAt: true,
        },
      });

      expect(result).toEqual({
        id: 'fm-1',
        text: 'Хочу больше отчётов',
        createdAt: createdAt.toISOString(),
        processedAt: null,
      });
    });

    it('orgId=null если у пользователя нет org', async () => {
      const prismaStub = makePrisma({
        createReturn: {
          id: 'fm-2',
          text: 'feedback',
          createdAt: new Date(),
          processedAt: null,
        },
      });
      const svc = new FeedbackService(
        prismaStub.prisma,
        makeRedis().redis,
        makeTopicManager().manager,
      );

      await svc.submit('u-1', null, 'feedback');

      expect(prismaStub.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: null }),
        }),
      );
    });

    it('сериализует processedAt в ISO, если он уже выставлен', async () => {
      const processedAt = new Date(Date.UTC(2026, 4, 26, 1, 0, 0));
      const prismaStub = makePrisma({
        createReturn: {
          id: 'fm-3',
          text: 'x',
          createdAt: new Date(),
          processedAt,
        },
      });
      const svc = new FeedbackService(
        prismaStub.prisma,
        makeRedis().redis,
        makeTopicManager().manager,
      );
      const out = await svc.submit('u-1', null, 'x');
      expect(out.processedAt).toBe(processedAt.toISOString());
    });
  });

  describe('listMine', () => {
    it('возвращает items + total + пагинация, скип = (page-1)*pageSize, сорт desc', async () => {
      const t1 = new Date(Date.UTC(2026, 4, 25, 10, 0, 0));
      const t2 = new Date(Date.UTC(2026, 4, 24, 10, 0, 0));
      const prismaStub = makePrisma({
        findManyReturn: [
          { id: 'a', text: 'foo', createdAt: t1, processedAt: null },
          { id: 'b', text: 'bar', createdAt: t2, processedAt: null },
        ],
        countReturn: 17,
      });
      const svc = new FeedbackService(
        prismaStub.prisma,
        makeRedis().redis,
        makeTopicManager().manager,
      );

      const result = await svc.listMine('u-1', 2, 5);

      expect(prismaStub.findMany).toHaveBeenCalledTimes(1);
      expect(prismaStub.findMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        orderBy: { createdAt: 'desc' },
        skip: 5, // (2-1)*5
        take: 5,
        select: {
          id: true,
          text: true,
          createdAt: true,
          processedAt: true,
        },
      });
      expect(prismaStub.count).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
      });
      expect(result.total).toBe(17);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(5);
      expect(result.items).toEqual([
        { id: 'a', text: 'foo', createdAt: t1.toISOString(), processedAt: null },
        { id: 'b', text: 'bar', createdAt: t2.toISOString(), processedAt: null },
      ]);
    });

    it('skip=0 для первой страницы', async () => {
      const prismaStub = makePrisma({ findManyReturn: [], countReturn: 0 });
      const svc = new FeedbackService(
        prismaStub.prisma,
        makeRedis().redis,
        makeTopicManager().manager,
      );
      await svc.listMine('u-1', 1, 20);
      expect(prismaStub.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });

  describe('getLimit', () => {
    it('читает Redis по ключу UTC и возвращает usedToday/limit/resetAt(00:00 UTC завтра)', async () => {
      const redisStub = makeRedis('3');
      const prismaStub = makePrisma();
      const svc = new FeedbackService(
        prismaStub.prisma,
        redisStub.redis,
        makeTopicManager().manager,
      );

      const result = await svc.getLimit('u-1');

      expect(redisStub.get).toHaveBeenCalledTimes(1);
      expect(redisStub.get).toHaveBeenCalledWith(
        'feedback:ratelimit:u-1:2026-05-25',
      );
      expect(result.usedToday).toBe(3);
      expect(result.limit).toBe(5);
      // ближайшая полночь UTC после 2026-05-25 12:34:56 UTC — 2026-05-26 00:00:00 UTC
      expect(result.resetAt).toBe('2026-05-26T00:00:00.000Z');
    });

    it('Redis пустой (null) → usedToday=0', async () => {
      const redisStub = makeRedis(null);
      const svc = new FeedbackService(
        makePrisma().prisma,
        redisStub.redis,
        makeTopicManager().manager,
      );
      const result = await svc.getLimit('u-1');
      expect(result.usedToday).toBe(0);
    });

    it('Redis вернул мусор (NaN) → usedToday=0', async () => {
      const redisStub = makeRedis('not-a-number');
      const svc = new FeedbackService(
        makePrisma().prisma,
        redisStub.redis,
        makeTopicManager().manager,
      );
      const result = await svc.getLimit('u-1');
      expect(result.usedToday).toBe(0);
    });

    it('Redis упал → usedToday=0 (fail-open)', async () => {
      const get = vi.fn(async () => {
        throw new Error('redis down');
      });
      const redis = { client: { get } } as unknown as RedisService;
      const svc = new FeedbackService(
        makePrisma().prisma,
        redis,
        makeTopicManager().manager,
      );
      const result = await svc.getLimit('u-1');
      expect(result.usedToday).toBe(0);
      expect(result.limit).toBe(5);
    });
  });

  // ──────────────────────── admin: фасады ────────────────────────

  describe('admin facades', () => {
    it('listTopics делегирует в topicManager.listTopics', async () => {
      const tm = makeTopicManager();
      const svc = new FeedbackService(
        makePrisma().prisma,
        makeRedis().redis,
        tm.manager,
      );
      await svc.listTopics({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });
      expect(tm.listTopics).toHaveBeenCalledTimes(1);
      expect(tm.listTopics).toHaveBeenCalledWith({
        window: '30',
        sort: 'percent',
        page: 1,
        pageSize: 20,
        includeArchived: false,
      });
    });

    it('getTopicDetails делегирует в topicManager.getTopic', async () => {
      const tm = makeTopicManager();
      const svc = new FeedbackService(
        makePrisma().prisma,
        makeRedis().redis,
        tm.manager,
      );
      await svc.getTopicDetails('t-1', '90');
      expect(tm.getTopic).toHaveBeenCalledWith('t-1', '90');
    });

    it('getTopicItems делегирует в topicManager.listItems', async () => {
      const tm = makeTopicManager();
      const svc = new FeedbackService(
        makePrisma().prisma,
        makeRedis().redis,
        tm.manager,
      );
      await svc.getTopicItems('t-1', 2, 50);
      expect(tm.listItems).toHaveBeenCalledWith('t-1', 2, 50);
    });

    it('getMessageById делегирует в topicManager.getItemMessage', async () => {
      const tm = makeTopicManager();
      const svc = new FeedbackService(
        makePrisma().prisma,
        makeRedis().redis,
        tm.manager,
      );
      await svc.getMessageById('t-1', 'i-1');
      expect(tm.getItemMessage).toHaveBeenCalledWith('t-1', 'i-1');
    });
  });

  // ──────────────────────── admin: listFailedMessages ────────────────────────

  describe('listFailedMessages', () => {
    it('фильтр failedRuns>=3 AND processedAt=null + маппинг userEmail', async () => {
      const created = new Date(Date.UTC(2026, 4, 25, 10, 0, 0));
      const findMany = vi.fn(
        async (_args: unknown) =>
          [
            {
              id: 'fm-1',
              userId: 'u-1',
              text: 'упал',
              createdAt: created,
              failedRuns: 5,
              user: { email: 'fail@z' },
            },
          ] as unknown[],
      );
      const count = vi.fn(async (_args: unknown) => 1);
      const prisma = {
        feedbackMessage: { findMany, count },
        $transaction: vi.fn(async (ops: Promise<unknown>[]) =>
          Promise.all(ops),
        ),
      } as unknown as PrismaService;

      const svc = new FeedbackService(
        prisma,
        makeRedis().redis,
        makeTopicManager().manager,
      );
      const result = await svc.listFailedMessages(1, 20);

      expect(findMany).toHaveBeenCalledTimes(1);
      const callArgs = (findMany.mock.calls[0]![0]) as {
        where: { failedRuns: { gte: number }; processedAt: null };
        orderBy: Array<Record<string, string>>;
        skip: number;
        take: number;
      };
      expect(callArgs.where).toEqual({
        failedRuns: { gte: 3 },
        processedAt: null,
      });
      expect(callArgs.orderBy).toEqual([
        { failedRuns: 'desc' },
        { createdAt: 'desc' },
      ]);
      expect(callArgs.skip).toBe(0);
      expect(callArgs.take).toBe(20);
      expect(result.total).toBe(1);
      expect(result.items[0]!).toEqual({
        id: 'fm-1',
        userId: 'u-1',
        userEmail: 'fail@z',
        text: 'упал',
        createdAt: created.toISOString(),
        failedRuns: 5,
      });
    });

    it('пагинация: page=3 pageSize=10 → skip=20', async () => {
      const findMany = vi.fn(async (_args: unknown) => [] as unknown[]);
      const count = vi.fn(async (_args: unknown) => 0);
      const prisma = {
        feedbackMessage: { findMany, count },
        $transaction: vi.fn(async (ops: Promise<unknown>[]) =>
          Promise.all(ops),
        ),
      } as unknown as PrismaService;

      const svc = new FeedbackService(
        prisma,
        makeRedis().redis,
        makeTopicManager().manager,
      );
      const result = await svc.listFailedMessages(3, 10);
      const callArgs = (findMany.mock.calls[0]![0]) as { skip: number; take: number };
      expect(callArgs.skip).toBe(20);
      expect(callArgs.take).toBe(10);
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
    });
  });
});
