import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import {
  CommitmentReliabilityService,
  reliabilityOrLowData,
} from './commitment-reliability.service';

const NOW = new Date('2026-05-30T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(deltaDays: number): Date {
  return new Date(NOW.getTime() + deltaDays * DAY_MS);
}

interface MockRow {
  commitmentStatus: string | null;
  commitmentDueDate: Date | null;
}

function buildService(
  opts: {
    rows?: MockRow[];
    cacheValue?: string | null;
    cacheGetError?: Error;
    cacheSetError?: Error;
    minDenominator?: number;
  } = {},
): {
  service: CommitmentReliabilityService;
  prisma: { ideaBlock: { findMany: ReturnType<typeof vi.fn> } };
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => opts.rows ?? []);
  const prisma = { ideaBlock: { findMany } };

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

  const cfg = {
    getDynamic: vi.fn(async () => opts.minDenominator ?? 3),
  } as unknown as TypedConfigService;

  const service = new CommitmentReliabilityService(prisma as unknown as PrismaService, redis, cfg);

  return { service, prisma, redisGet, redisSet };
}

describe('CommitmentReliabilityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('валидация scope', () => {
    it('person без scopeId → BadRequestException(scope_id_required)', async () => {
      const { service } = buildService();
      await expect(
        service.computeReliability({ tenantId: 't-1', scope: 'person' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('team без scopeId → BadRequestException', async () => {
      const { service } = buildService();
      await expect(
        service.computeReliability({ tenantId: 't-1', scope: 'team' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('person с пустой строкой → BadRequestException', async () => {
      const { service } = buildService();
      await expect(
        service.computeReliability({ tenantId: 't-1', scope: 'person', scopeId: '' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('company scope, нет данных', () => {
    it('возвращает нули + sparkline из 12 null + delta14d=null', async () => {
      const { service } = buildService({ rows: [] });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(dto.scope).toBe('company');
      expect(dto.scopeId).toBeNull();
      expect(dto.windowDays).toBe(14);
      expect(dto.kept).toBe(0);
      expect(dto.broken).toBe(0);
      expect(dto.overdue).toBe(0);
      expect(dto.pendingActive).toBe(0);
      expect(dto.reliabilityPercent).toBe(0);
      expect(dto.delta14d).toBeNull();
      expect(dto.sparkline12w).toHaveLength(12);
      expect(dto.sparkline12w.every((v) => v === null)).toBe(true);
    });
  });

  describe('company scope, есть данные', () => {
    it('5 fulfilled + 2 missed + 1 overdue + 1 pendingActive → 63%', async () => {
      const rows: MockRow[] = [
        ...Array.from({ length: 5 }, () => ({
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-3),
        })),
        ...Array.from({ length: 2 }, () => ({
          commitmentStatus: 'missed',
          commitmentDueDate: daysFromNow(-5),
        })),
        {
          commitmentStatus: 'open',
          commitmentDueDate: daysFromNow(-2),
        },
        {
          commitmentStatus: 'open',
          commitmentDueDate: new Date(NOW.getTime()),
        },
      ];

      const { service } = buildService({ rows });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(dto.kept).toBe(5);
      expect(dto.broken).toBe(2);
      expect(dto.overdue).toBe(1);
      expect(dto.pendingActive).toBe(1);
      expect(dto.reliabilityPercent).toBe(63);
    });
  });

  describe('delta14d', () => {
    it('текущее окно 100% vs предыдущее 50% → delta=+50', async () => {
      const rows: MockRow[] = [
        ...Array.from({ length: 5 }, () => ({
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-3),
        })),
        ...Array.from({ length: 2 }, () => ({
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-20),
        })),
        ...Array.from({ length: 2 }, () => ({
          commitmentStatus: 'missed',
          commitmentDueDate: daysFromNow(-22),
        })),
      ];

      const { service } = buildService({ rows });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(dto.reliabilityPercent).toBe(100);
      expect(dto.delta14d).toBe(50);
    });

    it('delta14d=null когда предыдущее окно пусто', async () => {
      const rows: MockRow[] = [
        {
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-2),
        },
      ];

      const { service } = buildService({ rows });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(dto.reliabilityPercent).toBe(100);
      expect(dto.delta14d).toBeNull();
    });
  });

  describe('sparkline12w', () => {
    it('всегда массив длины 12, порядок от старой к новой', async () => {
      const rows: MockRow[] = [
        {
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-3),
        },
        {
          commitmentStatus: 'missed',
          commitmentDueDate: daysFromNow(-80),
        },
      ];

      const { service } = buildService({ rows });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(dto.sparkline12w).toHaveLength(12);
      expect(dto.sparkline12w[0]).toBe(0);
      expect(dto.sparkline12w[11]).toBe(100);
      expect(dto.sparkline12w[5]).toBeNull();
    });
  });

  describe('фильтры scope в Prisma where', () => {
    it('person scope с scopeId — фильтр commitmentRecipientPersonId', async () => {
      const { service, prisma } = buildService({ rows: [] });
      await service.computeReliability({ tenantId: 't-1', scope: 'person', scopeId: 'p-1' }, NOW);

      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);
      const call = prisma.ideaBlock.findMany.mock.calls[0]![0];
      expect(call.where.tenantId).toBe('t-1');
      expect(call.where.signalType).toBe('commitment');
      expect(call.where.commitmentRecipientPersonId).toBe('p-1');
      expect(call.where.commitmentRecipient).toBeUndefined();
    });

    it('team scope с scopeId — nested where commitmentRecipient.primaryDepartmentId', async () => {
      const { service, prisma } = buildService({ rows: [] });
      await service.computeReliability({ tenantId: 't-1', scope: 'team', scopeId: 'dep-1' }, NOW);

      const call = prisma.ideaBlock.findMany.mock.calls[0]![0];
      expect(call.where.commitmentRecipient).toEqual({
        primaryDepartmentId: 'dep-1',
      });
      expect(call.where.commitmentRecipientPersonId).toBeUndefined();
    });

    it('company scope — без фильтров recipient, но с гейтом полноты', async () => {
      const { service, prisma } = buildService({ rows: [] });
      await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      const call = prisma.ideaBlock.findMany.mock.calls[0]![0];
      expect(call.where.commitmentRecipient).toBeUndefined();
      expect(call.where.commitmentRecipientPersonId).toBeUndefined();
      expect(call.where.commitmentAuthorPersonId).toEqual({ not: null });
      expect(call.where.OR).toEqual([
        { commitmentRecipientPersonId: { not: null } },
        { commitmentDueDate: { not: null } },
      ]);
    });
  });

  describe('Redis-кэш', () => {
    it('cache-hit: при втором вызове Prisma НЕ дёргается', async () => {
      const rows: MockRow[] = [
        {
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-2),
        },
      ];
      const { service, prisma, redisGet } = buildService({ rows });

      const first = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);
      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);

      redisGet.mockResolvedValueOnce(JSON.stringify(first));

      const second = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('ошибка Redis.get → fallback на live-подсчёт, не падает', async () => {
      const rows: MockRow[] = [
        {
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-2),
        },
      ];
      const { service, prisma } = buildService({
        rows,
        cacheGetError: new Error('Redis down'),
      });

      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);
      expect(dto.kept).toBe(1);
      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);
    });

    it('ошибка Redis.set → результат всё равно возвращается', async () => {
      const rows: MockRow[] = [
        {
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-2),
        },
      ];
      const { service } = buildService({
        rows,
        cacheSetError: new Error('Redis down'),
      });

      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);
      expect(dto.kept).toBe(1);
    });

    it('cache-ключ включает scope+scopeId+windowDays (+recipient по умолчанию)', async () => {
      const { service, redisGet } = buildService({ rows: [] });

      await service.computeReliability(
        { tenantId: 't-1', scope: 'person', scopeId: 'p-1', windowDays: 7 },
        NOW,
      );

      expect(redisGet).toHaveBeenCalledWith('commit_reliability:t-1:person:p-1:7:recipient');
    });
  });

  describe('cancelled / superseded', () => {
    it('игнорируются в kept/broken/overdue/pendingActive', async () => {
      const rows: MockRow[] = [
        {
          commitmentStatus: 'fulfilled',
          commitmentDueDate: daysFromNow(-2),
        },
        {
          commitmentStatus: 'cancelled',
          commitmentDueDate: daysFromNow(-3),
        },
        {
          commitmentStatus: 'superseded',
          commitmentDueDate: daysFromNow(-4),
        },
        {
          commitmentStatus: null,
          commitmentDueDate: daysFromNow(-5),
        },
      ];

      const { service } = buildService({ rows });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);

      expect(dto.kept).toBe(1);
      expect(dto.broken).toBe(0);
      expect(dto.overdue).toBe(0);
      expect(dto.pendingActive).toBe(0);
      expect(dto.reliabilityPercent).toBe(100);
    });
  });

  describe('personMode (ТЗ-D — надёжность по автору)', () => {
    interface BuildWhereFn {
      buildWhere: (
        a: {
          tenantId: string;
          scope: 'company' | 'team' | 'person';
          scopeId?: string;
          windowDays?: number;
          personMode?: 'recipient' | 'author';
        },
        start: Date,
        now: Date,
      ) => Record<string, unknown>;
    }
    interface BuildCacheKeyFn {
      buildCacheKey: (
        tenantId: string,
        scope: string,
        scopeId: string | null,
        windowDays: number,
        personMode?: 'recipient' | 'author',
      ) => string;
    }

    const START = daysFromNow(-84);

    it('buildWhere person + personMode=author → commitmentAuthorPersonId, без recipient', () => {
      const { service } = buildService();
      const where = (service as unknown as BuildWhereFn).buildWhere(
        { scope: 'person', scopeId: 'P1', personMode: 'author', tenantId: 't1' },
        START,
        NOW,
      );

      expect(where.commitmentAuthorPersonId).toBe('P1');
      expect(where.commitmentRecipientPersonId).toBeUndefined();
    });

    it('buildWhere person без personMode → commitmentRecipientPersonId (обратная совместимость) + гейт полноты (автор не null)', () => {
      const { service } = buildService();
      const where = (service as unknown as BuildWhereFn).buildWhere(
        { scope: 'person', scopeId: 'P1', tenantId: 't1' },
        START,
        NOW,
      );

      expect(where.commitmentRecipientPersonId).toBe('P1');
      expect(where.commitmentAuthorPersonId).toEqual({ not: null });
    });

    it('buildCacheKey: author-ключ отличается от recipient/undefined и содержит :author', () => {
      const { service } = buildService();
      const fn = (service as unknown as BuildCacheKeyFn).buildCacheKey.bind(service);

      const authorKey = fn('t1', 'person', 'P1', 14, 'author');
      const recipientKey = fn('t1', 'person', 'P1', 14, 'recipient');
      const defaultKey = fn('t1', 'person', 'P1', 14, undefined);

      expect(authorKey).not.toBe(recipientKey);
      expect(authorKey).not.toBe(defaultKey);
      expect(defaultKey).toBe(recipientKey);
      expect(authorKey).toContain(':author');
      expect(defaultKey).toContain(':recipient');
    });

    it('validateScope: person без scopeId всё ещё бросает BadRequestException(scope_id_required)', async () => {
      const { service } = buildService();
      await expect(
        service.computeReliability({ tenantId: 't-1', scope: 'person' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('computeReliability person + author прокидывает фильтр в Prisma', async () => {
      const { service, prisma } = buildService({ rows: [] });
      await service.computeReliability(
        { tenantId: 't-1', scope: 'person', scopeId: 'p-1', personMode: 'author' },
        NOW,
      );

      const call = prisma.ideaBlock.findMany.mock.calls[0]![0];
      expect(call.where.commitmentAuthorPersonId).toBe('p-1');
      expect(call.where.commitmentRecipientPersonId).toBeUndefined();
    });
  });

  describe('ТЗ-1 Ф3.D.2 — «мало данных» (reliabilityLowData)', () => {
    it('крошечный знаменатель (1 fulfilled < min 3) → reliabilityLowData=true', async () => {
      const { service } = buildService({
        minDenominator: 3,
        rows: [{ commitmentStatus: 'fulfilled', commitmentDueDate: daysFromNow(-2) }],
      });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);
      expect(dto.reliabilityPercent).toBe(100);
      expect(dto.reliabilityLowData).toBe(true);
    });

    it('знаменатель >= min → reliabilityLowData=false', async () => {
      const { service } = buildService({
        minDenominator: 3,
        rows: [
          { commitmentStatus: 'fulfilled', commitmentDueDate: daysFromNow(-2) },
          { commitmentStatus: 'fulfilled', commitmentDueDate: daysFromNow(-3) },
          { commitmentStatus: 'missed', commitmentDueDate: daysFromNow(-4) },
        ],
      });
      const dto = await service.computeReliability({ tenantId: 't-1', scope: 'company' }, NOW);
      expect(dto.reliabilityLowData).toBe(false);
    });
  });
});

describe('reliabilityOrLowData (ТЗ-1 Ф3.D.2 — чистая функция)', () => {
  it('denom < minDenom → null (мало данных)', () => {
    expect(reliabilityOrLowData(1, 1, 3)).toBeNull();
    expect(reliabilityOrLowData(2, 2, 3)).toBeNull();
  });
  it('denom <= 0 → null', () => {
    expect(reliabilityOrLowData(0, 0, 3)).toBeNull();
    expect(reliabilityOrLowData(0, -1, 3)).toBeNull();
  });
  it('denom >= minDenom → процент round(kept/denom*100)', () => {
    expect(reliabilityOrLowData(3, 3, 3)).toBe(100);
    expect(reliabilityOrLowData(2, 4, 3)).toBe(50);
    expect(reliabilityOrLowData(1, 3, 3)).toBe(33);
  });
});
