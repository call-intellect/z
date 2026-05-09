import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { AuditLogService } from '../audit/audit-log.service';

import { QuotaExceededError } from './quota.errors';
import { QuotaService } from './quota.service';

interface MultiBuilder {
  incrby: (...args: unknown[]) => MultiBuilder;
  expire: (...args: unknown[]) => MultiBuilder;
  exec: () => Promise<Array<[Error | null, unknown]>>;
}

function makeRedis(incrReturn: number): RedisService {
  const multi = (): MultiBuilder => {
    const builder: MultiBuilder = {
      incrby: () => builder,
      expire: () => builder,
      exec: async () => [
        [null, incrReturn],
        [null, 1],
      ],
    };
    return builder;
  };
  const client = {
    multi: vi.fn(multi),
    decrby: vi.fn(async () => 0),
    get: vi.fn(async () => '0'),
  };
  return { client } as unknown as RedisService;
}

function makePrisma(): PrismaService {
  return {
    userQuotaCounter: {
      upsert: vi.fn(async () => undefined),
    },
  } as unknown as PrismaService;
}

function makeAudit(): AuditLogService {
  return { log: vi.fn(async () => undefined) } as unknown as AuditLogService;
}

function makeMetrics(): BusinessMetricsService {
  return { incQuotaExceeded: vi.fn() } as unknown as BusinessMetricsService;
}

describe('QuotaService.checkAndIncrement', () => {
  it('current <= max → ok', async () => {
    const svc = new QuotaService(makeRedis(3), makePrisma(), makeAudit(), makeMetrics());
    const result = await svc.checkAndIncrement({
      userId: 'u1',
      quotaName: 'chat_per_day',
      max: 5,
      windowMs: 86_400_000,
    });
    expect(result).toEqual({ ok: true, current: 3, remaining: 2 });
  });

  it('current > max → QuotaExceededError + DECR rollback + audit', async () => {
    const redis = makeRedis(6);
    const audit = makeAudit();
    const metrics = makeMetrics();
    const svc = new QuotaService(redis, makePrisma(), audit, metrics);
    await expect(
      svc.checkAndIncrement({
        userId: 'u1',
        quotaName: 'chat_per_day',
        max: 5,
        windowMs: 86_400_000,
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(redis.client.decrby).toHaveBeenCalledWith(
      expect.stringContaining('quota:u1:chat_per_day:'),
      1,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'quota.exceeded',
      }),
    );
    expect(metrics.incQuotaExceeded).toHaveBeenCalledWith({ quotaName: 'chat_per_day' });
  });

  it('amount > 1 учитывается', async () => {
    const svc = new QuotaService(makeRedis(15), makePrisma(), makeAudit(), makeMetrics());
    const result = await svc.checkAndIncrement({
      userId: 'u',
      quotaName: 'tokens',
      max: 100,
      windowMs: 1000,
      amount: 5,
    });
    expect(result.current).toBe(15);
    expect(result.remaining).toBe(85);
  });

  it('snapshot в БД при current % 10 === 0', async () => {
    const prisma = makePrisma();
    const svc = new QuotaService(makeRedis(10), prisma, makeAudit(), makeMetrics());
    await svc.checkAndIncrement({
      userId: 'u',
      quotaName: 'q',
      max: 100,
      windowMs: 60_000,
    });
    // snapshot — fire-and-forget; ждём микротаску.
    await new Promise((r) => setImmediate(r));
    expect(prisma.userQuotaCounter.upsert).toHaveBeenCalled();
  });
});
