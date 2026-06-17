import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { HangingDecisionsService } from './hanging-decisions.service';

const NOW = new Date('2026-05-30T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

interface MockEvent {
  lastRaisedAt: Date | null;
}

function buildService(
  opts: {
    count?: number;
    events?: MockEvent[];
    cacheValue?: string | null;
    cacheGetError?: Error;
    cacheSetError?: Error;
  } = {},
): {
  service: HangingDecisionsService;
  prisma: {
    decision: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
} {
  const countMock = vi.fn(async () => opts.count ?? 0);
  const findManyMock = vi.fn(async () => opts.events ?? []);
  const prisma = {
    decision: { count: countMock, findMany: findManyMock },
  };

  const redisGet = vi.fn(async () => {
    if (opts.cacheGetError) throw opts.cacheGetError;
    return opts.cacheValue ?? null;
  });
  const redisSet = vi.fn(async () => {
    if (opts.cacheSetError) throw opts.cacheSetError;
    return 'OK';
  });
  const redis = {
    client: { get: redisGet, set: redisSet },
  } as unknown as RedisService;

  const service = new HangingDecisionsService(prisma as unknown as PrismaService, redis);

  return { service, prisma, redisGet, redisSet };
}

describe('HangingDecisionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('пустой tenant', () => {
    it('count=0 + sparkline12w из 12 нулей', async () => {
      const { service } = buildService({ count: 0, events: [] });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      expect(dto.count).toBe(0);
      expect(dto.minAgeDays).toBe(7);
      expect(dto.minRaisedCount).toBe(2);
      expect(dto.sparkline12w).toHaveLength(12);
      expect(dto.sparkline12w.every((v) => v === 0)).toBe(true);
    });
  });

  describe('count', () => {
    it('5 hanging decisions → count=5', async () => {
      const { service } = buildService({ count: 5, events: [] });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });
      expect(dto.count).toBe(5);
    });

    it('public count() c default параметрами (7d, 2)', async () => {
      const { service, prisma } = buildService({ count: 3, events: [] });
      const dto = await service.count({ tenantId: 't-1' });

      expect(dto.count).toBe(3);
      expect(dto.minAgeDays).toBe(7);
      expect(dto.minRaisedCount).toBe(2);

      const whereCount = prisma.decision.count.mock.calls[0]![0].where;
      expect(whereCount.raisedCount).toEqual({ gte: 2 });
      expect(whereCount.status).toEqual({
        in: ['proposed', 'approved', 'active'],
      });
    });
  });

  describe('фильтры в Prisma where', () => {
    it('status фильтрует только {proposed, approved, active}', async () => {
      const { service, prisma } = buildService({ count: 0, events: [] });
      await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      const whereCount = prisma.decision.count.mock.calls[0]![0].where;
      expect(whereCount.status).toEqual({
        in: ['proposed', 'approved', 'active'],
      });
      expect(whereCount.status.in).not.toContain('implemented');
      expect(whereCount.status.in).not.toContain('cancelled');
      expect(whereCount.status.in).not.toContain('rejected');
    });

    it('raisedCount фильтрует по minRaisedCount=2 (default)', async () => {
      const { service, prisma } = buildService({ count: 0, events: [] });
      await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      const whereCount = prisma.decision.count.mock.calls[0]![0].where;
      expect(whereCount.raisedCount).toEqual({ gte: 2 });
    });

    it('createdAt фильтрует по ageThreshold = now - 7 дней', async () => {
      const { service, prisma } = buildService({ count: 0, events: [] });
      await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      const whereCount = prisma.decision.count.mock.calls[0]![0].where;
      const expectedThreshold = new Date(NOW.getTime() - 7 * DAY_MS);
      expect(whereCount.createdAt).toEqual({ lte: expectedThreshold });
    });

    it('кастомные параметры — minAgeDays=14 + minRaisedCount=5', async () => {
      const { service, prisma } = buildService({ count: 0, events: [] });
      await service.compute({
        tenantId: 't-1',
        minAgeDays: 14,
        minRaisedCount: 5,
        now: NOW,
      });

      const whereCount = prisma.decision.count.mock.calls[0]![0].where;
      expect(whereCount.raisedCount).toEqual({ gte: 5 });
      const expectedThreshold = new Date(NOW.getTime() - 14 * DAY_MS);
      expect(whereCount.createdAt).toEqual({ lte: expectedThreshold });
    });

    it('findMany для sparkline использует тот же фильтр + lastRaisedAt окно 12w', async () => {
      const { service, prisma } = buildService({ count: 0, events: [] });
      await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      const whereFind = prisma.decision.findMany.mock.calls[0]![0].where;
      expect(whereFind.tenantId).toBe('t-1');
      expect(whereFind.status).toEqual({
        in: ['proposed', 'approved', 'active'],
      });
      expect(whereFind.raisedCount).toEqual({ gte: 2 });
      const sparklineStart = new Date(NOW.getTime() - 12 * 7 * DAY_MS);
      expect(whereFind.lastRaisedAt).toEqual({
        gte: sparklineStart,
        lt: NOW,
      });
    });
  });

  describe('sparkline12w bucket-логика', () => {
    it('1 событие при -5d → buckets[11]=1 (последняя завершившаяся неделя)', async () => {
      const events: MockEvent[] = [{ lastRaisedAt: new Date(NOW.getTime() - 5 * DAY_MS) }];
      const { service } = buildService({ count: 1, events });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      expect(dto.sparkline12w).toHaveLength(12);
      expect(dto.sparkline12w[11]).toBe(1);
      const rest = dto.sparkline12w.filter((_, i) => i !== 11);
      expect(rest.every((v) => v === 0)).toBe(true);
    });

    it('1 событие при -3w (-21d) → buckets[8]=1', async () => {
      const events: MockEvent[] = [{ lastRaisedAt: new Date(NOW.getTime() - 21 * DAY_MS) }];
      const { service } = buildService({ count: 1, events });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      expect(dto.sparkline12w[9]).toBe(1);
      const rest = dto.sparkline12w.filter((_, i) => i !== 9);
      expect(rest.every((v) => v === 0)).toBe(true);
    });

    it('несколько событий в одной неделе суммируются', async () => {
      const events: MockEvent[] = [
        { lastRaisedAt: new Date(NOW.getTime() - 3 * DAY_MS) },
        { lastRaisedAt: new Date(NOW.getTime() - 4 * DAY_MS) },
        { lastRaisedAt: new Date(NOW.getTime() - 5 * DAY_MS) },
      ];
      const { service } = buildService({ count: 3, events });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      expect(dto.sparkline12w[11]).toBe(3);
    });

    it('lastRaisedAt=null игнорируется', async () => {
      const events: MockEvent[] = [
        { lastRaisedAt: null },
        { lastRaisedAt: new Date(NOW.getTime() - 3 * DAY_MS) },
      ];
      const { service } = buildService({ count: 1, events });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      const total = dto.sparkline12w.reduce((a, b) => a + b, 0);
      expect(total).toBe(1);
    });

    it('событие старше 12 недель игнорируется', async () => {
      const events: MockEvent[] = [{ lastRaisedAt: new Date(NOW.getTime() - 100 * DAY_MS) }];
      const { service } = buildService({ count: 1, events });
      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      expect(dto.sparkline12w.every((v) => v === 0)).toBe(true);
    });
  });

  describe('Redis-кэш', () => {
    it('cache-hit: при втором вызове Prisma НЕ дёргается', async () => {
      const { service, prisma, redisGet } = buildService({
        count: 5,
        events: [],
      });

      const first = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });
      expect(prisma.decision.count).toHaveBeenCalledTimes(1);
      expect(prisma.decision.findMany).toHaveBeenCalledTimes(1);

      redisGet.mockResolvedValueOnce(JSON.stringify(first));

      const second = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });

      expect(prisma.decision.count).toHaveBeenCalledTimes(1);
      expect(prisma.decision.findMany).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('ошибка Redis.get → fallback на Prisma, не падает', async () => {
      const { service, prisma } = buildService({
        count: 5,
        events: [],
        cacheGetError: new Error('Redis down'),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });
      expect(dto.count).toBe(5);
      expect(prisma.decision.count).toHaveBeenCalledTimes(1);
    });

    it('ошибка Redis.set → результат всё равно возвращается', async () => {
      const { service } = buildService({
        count: 2,
        events: [],
        cacheSetError: new Error('Redis down'),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        minAgeDays: 7,
        minRaisedCount: 2,
        now: NOW,
      });
      expect(dto.count).toBe(2);
    });

    it('cache-ключ включает tenantId + minAgeDays + minRaisedCount', async () => {
      const { service, redisGet } = buildService({ count: 0, events: [] });

      await service.compute({
        tenantId: 't-42',
        minAgeDays: 14,
        minRaisedCount: 5,
        now: NOW,
      });

      expect(redisGet).toHaveBeenCalledWith('hanging_decisions:t-42:14:5');
    });
  });

  describe('listHangingWithAuthors (ТЗ coo-orphan-agents Ф2)', () => {
    it('пробрасывает результат findMany и фильтрует по where (status/raisedCount/createdAt)', async () => {
      const { service, prisma } = buildService();
      prisma.decision.findMany.mockResolvedValueOnce([{ id: 'd-1', decidedByPersonIds: ['p-1'] }]);

      const res = await service.listHangingWithAuthors({
        tenantId: 't-1',
        now: NOW,
      });

      expect(res).toEqual([{ id: 'd-1', decidedByPersonIds: ['p-1'] }]);

      const expectedThreshold = new Date(NOW.getTime() - 7 * DAY_MS);
      expect(prisma.decision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't-1',
            status: { in: ['proposed', 'approved', 'active'] },
            raisedCount: { gte: 2 },
            createdAt: { lte: expectedThreshold },
          }),
          select: { id: true, decidedByPersonIds: true },
        }),
      );
    });
  });
});
