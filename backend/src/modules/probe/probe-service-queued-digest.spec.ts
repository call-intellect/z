/**
 * Probe-система Фаза 3 (2026-06-11) — ProbeService.suggest при исчерпанном
 * бюджете получателя.
 *
 * R5: deferrable-probe сверх лимита → status='queued_digest' (НЕ
 * dropped_rate_limit), dispatcher НЕ enqueue'ится. R6: immediate-probe при
 * лимите сохраняет drop. Детерминизм: Redis/Prisma/Queue/Cfg/Metrics мокированы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';

import { ProbeService } from './probe.service';

function makeService(): {
  service: ProbeService;
  create: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const create = vi
    .fn()
    .mockImplementation(async (args: { data: { status: string } }) => ({
      id: 'probe-new-1',
      ...args.data,
    }));
  const prisma = {
    probeEvent: { create, findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  const redis = {
    client: {
      // dedup SET NX → '1' (не дубль, проходим дальше).
      set: vi.fn().mockResolvedValue('1'),
      // rate-limit GET → счётчики выше лимита → бюджет исчерпан.
      get: vi.fn().mockResolvedValue('99'),
    },
  } as unknown as RedisService;

  const enqueue = vi.fn().mockResolvedValue(undefined);
  const queue = {
    enqueueProbeEvent: enqueue,
  } as unknown as CoreQueueService;

  const cfg = {
    probe: {
      dedupTtlHours: 24,
      rateLimitPerHour: 5,
      rateLimitPerDay: 20,
      expiryDays: 14,
      coldStartModeHours: 0,
    },
  } as unknown as TypedConfigService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeRateLimitDropped: vi.fn(),
    incProbeDedupDropped: vi.fn(),
    incProbeColdStartDropped: vi.fn(),
  } as unknown as BusinessMetricsService;

  return {
    service: new ProbeService(prisma, redis, queue, cfg, metrics),
    create,
    enqueue,
  };
}

describe('ProbeService.suggest — бюджет исчерпан', () => {
  let env: ReturnType<typeof makeService>;

  beforeEach(() => {
    env = makeService();
  });

  it('deferrable reason → queued_digest, без enqueue dispatcher', async () => {
    const res = await env.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-6-ideas',
      reason: 'idea.status_unclear', // deferrable
      payload: { message: 'Идея зависла' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.4,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = env.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe('queued_digest');
    // Dispatcher НЕ ставится в очередь — дайджест-cron подберёт.
    expect(env.enqueue).not.toHaveBeenCalled();
  });

  it('immediate reason → dropped_rate_limit (прежнее поведение)', async () => {
    const res = await env.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-3-decisions',
      reason: 'decision.overdue', // immediate
      payload: { message: 'Решение просрочено' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.7,
    });

    expect('dropped' in res && res.dropped).toBe('rate_limit');
    const created = env.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe('dropped_rate_limit');
    expect(env.enqueue).not.toHaveBeenCalled();
  });
});
