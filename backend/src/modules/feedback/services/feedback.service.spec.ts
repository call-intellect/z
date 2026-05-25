/**
 * Unit-тесты для FeedbackService (пользовательская часть).
 *
 * Покрытие:
 *   - submit: создаёт FeedbackMessage с правильными полями (trim, orgId, defaults)
 *   - listMine: возвращает items + total + пагинация, сортировка createdAt desc
 *   - getLimit: читает Redis-ключ (UTC, формат feedback:ratelimit:{uid}:{YYYY-MM-DD})
 *               возвращает usedToday / limit=5 / resetAt в виде ISO полночи UTC
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

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

      const svc = new FeedbackService(prismaStub.prisma, redisStub.redis);
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
      const svc = new FeedbackService(prismaStub.prisma, makeRedis().redis);

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
      const svc = new FeedbackService(prismaStub.prisma, makeRedis().redis);
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
      const svc = new FeedbackService(prismaStub.prisma, makeRedis().redis);

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
      const svc = new FeedbackService(prismaStub.prisma, makeRedis().redis);
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
      const svc = new FeedbackService(prismaStub.prisma, redisStub.redis);

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
      const svc = new FeedbackService(makePrisma().prisma, redisStub.redis);
      const result = await svc.getLimit('u-1');
      expect(result.usedToday).toBe(0);
    });

    it('Redis вернул мусор (NaN) → usedToday=0', async () => {
      const redisStub = makeRedis('not-a-number');
      const svc = new FeedbackService(makePrisma().prisma, redisStub.redis);
      const result = await svc.getLimit('u-1');
      expect(result.usedToday).toBe(0);
    });

    it('Redis упал → usedToday=0 (fail-open)', async () => {
      const get = vi.fn(async () => {
        throw new Error('redis down');
      });
      const redis = { client: { get } } as unknown as RedisService;
      const svc = new FeedbackService(makePrisma().prisma, redis);
      const result = await svc.getLimit('u-1');
      expect(result.usedToday).toBe(0);
      expect(result.limit).toBe(5);
    });
  });
});
