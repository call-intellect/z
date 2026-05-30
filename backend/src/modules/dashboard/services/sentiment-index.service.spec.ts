/**
 * Unit-тесты `SentimentIndexService` (Pulse Wave 1 §1.3).
 *
 * Покрывают:
 *   - пустое окно (totalCheckIns=0) → value=0, trend=flat;
 *   - расчёт value = (greenShare - redShare) * 100, округление;
 *   - trend: up/down/flat по порогу 5 п.п.;
 *   - redShareDelta=null → trend=flat;
 *   - кастомный days пробрасывается в getTeamTemperature;
 *   - sparkline 12 недель: распределение по бакетам, null для пустых;
 *   - cache-hit: ops.getTeamTemperature не дёргается;
 *   - ошибки Redis — graceful fallback;
 *   - чек-ины с sentiment=null не попадают в выборку sparkline (фильтр where).
 *
 * Сервис вызывается через `compute({tenantId, days, now})` чтобы зафиксировать
 * время — это публичный helper, специально оставленный public для тестов.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { OperationsTeamTemperatureDto } from '../../operations/dto/operations-dashboard.dto';
import type { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

import { SentimentIndexService } from './sentiment-index.service';

const NOW = new Date('2026-05-30T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(deltaDays: number): Date {
  return new Date(NOW.getTime() + deltaDays * DAY_MS);
}

interface CheckInRow {
  sentiment: 'green' | 'yellow' | 'red';
  createdAt: Date;
}

function buildTemperature(overrides: Partial<OperationsTeamTemperatureDto> = {}): OperationsTeamTemperatureDto {
  return {
    days: 7,
    totalCheckIns: 0,
    greenShare: 0,
    yellowShare: 0,
    redShare: 0,
    redShareDelta: null,
    byPerson: [],
    ...overrides,
  };
}

function buildService(opts: {
  temperature?: OperationsTeamTemperatureDto;
  rows?: CheckInRow[];
  cacheValue?: string | null;
  cacheGetError?: Error;
  cacheSetError?: Error;
} = {}): {
  service: SentimentIndexService;
  prismaFindMany: ReturnType<typeof vi.fn>;
  getTeamTemperature: ReturnType<typeof vi.fn>;
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
} {
  const prismaFindMany = vi.fn(async () => opts.rows ?? []);
  const prisma = {
    dailyCheckIn: { findMany: prismaFindMany },
  } as unknown as PrismaService;

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

  const getTeamTemperature = vi.fn(async () => opts.temperature ?? buildTemperature());
  const ops = {
    getTeamTemperature,
  } as unknown as OperationsDashboardService;

  const service = new SentimentIndexService(prisma, redis, ops);

  return { service, prismaFindMany, getTeamTemperature, redisGet, redisSet };
}

describe('SentimentIndexService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('value расчёт', () => {
    it('пустое окно (totalCheckIns=0) → value=0, trend=flat, totalCheckIns=0', async () => {
      const { service } = buildService({
        temperature: buildTemperature({ totalCheckIns: 0 }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.value).toBe(0);
      expect(dto.trend).toBe('flat');
      expect(dto.totalCheckIns).toBe(0);
      expect(dto.days).toBe(7);
      expect(dto.sparkline12w).toHaveLength(12);
    });

    it('greenShare=0.6, redShare=0.2 → value=40', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 10,
          greenShare: 0.6,
          yellowShare: 0.2,
          redShare: 0.2,
          redShareDelta: null,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.value).toBe(40);
      expect(dto.trend).toBe('flat');
      expect(dto.totalCheckIns).toBe(10);
    });

    it('value округляется (greenShare=0.333, redShare=0.111 → ~22)', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 9,
          greenShare: 3 / 9,
          yellowShare: 5 / 9,
          redShare: 1 / 9,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      // (0.3333 - 0.1111) * 100 = 22.22 → 22
      expect(dto.value).toBe(22);
    });

    it('yellow-чек-ины не влияют на value', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 10,
          greenShare: 0.5,
          yellowShare: 0.5,
          redShare: 0,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      // 0.5 - 0 = 0.5 → 50
      expect(dto.value).toBe(50);
    });
  });

  describe('trend по redShareDelta', () => {
    it('redShareDelta=-0.10 (улучшение, red упал) → trend=up', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 5,
          greenShare: 0.6,
          redShare: 0.1,
          redShareDelta: -0.1,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.trend).toBe('up');
    });

    it('redShareDelta=+0.10 (ухудшение, red вырос) → trend=down', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 5,
          greenShare: 0.2,
          redShare: 0.5,
          redShareDelta: 0.1,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.trend).toBe('down');
    });

    it('redShareDelta=+0.03 (внутри порога 0.05) → trend=flat', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 5,
          greenShare: 0.4,
          redShare: 0.3,
          redShareDelta: 0.03,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.trend).toBe('flat');
    });

    it('redShareDelta=null → trend=flat', async () => {
      const { service } = buildService({
        temperature: buildTemperature({
          totalCheckIns: 5,
          greenShare: 0.6,
          redShare: 0.2,
          redShareDelta: null,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.trend).toBe('flat');
    });
  });

  describe('custom days', () => {
    it('days=14 пробрасывается в getTeamTemperature и возвращается в DTO', async () => {
      const { service, getTeamTemperature } = buildService({
        temperature: buildTemperature({ days: 14, totalCheckIns: 3 }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 14,
        now: NOW,
      });

      expect(getTeamTemperature).toHaveBeenCalledWith({
        tenantId: 't-1',
        days: 14,
      });
      expect(dto.days).toBe(14);
    });

    it('getIndex без days → default 7', async () => {
      const { service, getTeamTemperature } = buildService();
      await service.getIndex({ tenantId: 't-1' });
      expect(getTeamTemperature).toHaveBeenCalledWith({
        tenantId: 't-1',
        days: 7,
      });
    });
  });

  describe('sparkline12w', () => {
    it('1 green за 5 дней назад → buckets[11]=100; 1 red за ~3 недели назад → buckets[8]=-100; пустые недели → null', async () => {
      const rows: CheckInRow[] = [
        // Последняя неделя (-5 дней) → green
        { sentiment: 'green', createdAt: daysFromNow(-5) },
        // ~3 недели назад (-22 дня) → red
        // weeksAgo = floor((now - createdAt) / 7days) = floor(22/7) = 3
        // sparklineStart = now - 12 недель. bucket index = floor((t-start)/week_ms)
        // start = -84d от now. t = -22d. (t-start)=62d. idx = floor(62/7)=8.
        { sentiment: 'red', createdAt: daysFromNow(-22) },
      ];

      const { service } = buildService({
        temperature: buildTemperature(),
        rows,
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.sparkline12w).toHaveLength(12);
      expect(dto.sparkline12w[11]).toBe(100);
      expect(dto.sparkline12w[8]).toBe(-100);
      expect(dto.sparkline12w[0]).toBeNull();
      expect(dto.sparkline12w[5]).toBeNull();
    });

    it('sparkline всегда длины 12 даже при пустых данных', async () => {
      const { service } = buildService({ rows: [] });
      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.sparkline12w).toHaveLength(12);
      expect(dto.sparkline12w.every((v) => v === null)).toBe(true);
    });

    it('фильтр where передаёт sentiment IN (green,yellow,red) — sentiment=null не попадает', async () => {
      const { service, prismaFindMany } = buildService({ rows: [] });
      await service.compute({ tenantId: 't-1', days: 7, now: NOW });

      expect(prismaFindMany).toHaveBeenCalledTimes(1);
      const call = prismaFindMany.mock.calls[0]![0];
      expect(call.where.tenantId).toBe('t-1');
      expect(call.where.sentiment).toEqual({
        in: ['green', 'yellow', 'red'],
      });
      // sentiment=null отсеется фильтром {in: [...]}: тут проверяем структуру.
    });
  });

  describe('Redis-кэш', () => {
    it('cache-hit: ops.getTeamTemperature НЕ дёргается, возвращается кэш', async () => {
      const cached: SentimentIndexDtoForCache = {
        value: 42,
        trend: 'up',
        sparkline12w: Array.from({ length: 12 }, () => null),
        totalCheckIns: 7,
        days: 7,
      };

      const { service, getTeamTemperature, prismaFindMany } = buildService({
        cacheValue: JSON.stringify(cached),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.value).toBe(42);
      expect(dto.trend).toBe('up');
      expect(getTeamTemperature).not.toHaveBeenCalled();
      expect(prismaFindMany).not.toHaveBeenCalled();
    });

    it('ошибка Redis.get → fallback на live-подсчёт', async () => {
      const { service, getTeamTemperature } = buildService({
        cacheGetError: new Error('Redis down'),
        temperature: buildTemperature({
          totalCheckIns: 1,
          greenShare: 1,
          redShare: 0,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.value).toBe(100);
      expect(getTeamTemperature).toHaveBeenCalledTimes(1);
    });

    it('ошибка Redis.set → результат всё равно возвращается', async () => {
      const { service } = buildService({
        cacheSetError: new Error('Redis down'),
        temperature: buildTemperature({
          totalCheckIns: 2,
          greenShare: 0.5,
          redShare: 0.5,
        }),
      });

      const dto = await service.compute({
        tenantId: 't-1',
        days: 7,
        now: NOW,
      });

      expect(dto.value).toBe(0);
    });

    it('cache-ключ включает tenantId и days', async () => {
      const { service, redisGet } = buildService();

      await service.compute({ tenantId: 't-1', days: 14, now: NOW });

      expect(redisGet).toHaveBeenCalledWith('sentiment_index:t-1:14');
    });
  });
});

/** Локальный тип чтобы не импортировать DTO из тестируемого файла. */
interface SentimentIndexDtoForCache {
  value: number;
  trend: 'up' | 'flat' | 'down';
  sparkline12w: Array<number | null>;
  totalCheckIns: number;
  days: number;
}
