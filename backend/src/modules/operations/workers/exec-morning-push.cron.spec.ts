import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { PendingActionsService } from '../../pending-actions/services/pending-actions.service';

import { ExecMorningPushCron } from './exec-morning-push.cron';

interface PrismaMock {
  membership: { findMany: ReturnType<typeof vi.fn> };
  person: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): PrismaMock {
  return {
    membership: { findMany: vi.fn().mockResolvedValue([]) },
    person: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function makeRedis(setResult: 'OK' | null = 'OK'): RedisService {
  return {
    client: { set: vi.fn().mockResolvedValue(setResult) },
  } as unknown as RedisService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incExecMorningPushDelivered: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function makeCoreQueue(): CoreQueueService {
  return {
    enqueuePushSend: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
  } as unknown as CoreQueueService;
}

function makePending(total = 0): PendingActionsService {
  return {
    getCount: vi.fn().mockResolvedValue({
      total,
      bySource: { curation: total, conflict: 0, intake: 0, probe: 0 },
    }),
  } as unknown as PendingActionsService;
}

function makeCfg(killswitch = true, morningHour = 9): TypedConfigService {
  return {
    getDynamic: vi.fn(async (key: string, _env: unknown, fallback: unknown) => {
      if (key === 'operations.daily_digest.deliver_to_webpush') return killswitch;
      if (key === 'operations.daily_digest.webpush_morning_hour') return morningHour;
      return fallback;
    }),
  } as unknown as TypedConfigService;
}

function makeCron(
  deps: {
    prisma?: PrismaMock;
    redis?: RedisService;
    metrics?: BusinessMetricsService;
    coreQueue?: CoreQueueService;
    pending?: PendingActionsService;
    cfg?: TypedConfigService;
  } = {},
): {
  cron: ExecMorningPushCron;
  prisma: PrismaMock;
  redis: RedisService;
  metrics: BusinessMetricsService;
  coreQueue: CoreQueueService;
  pending: PendingActionsService;
  cfg: TypedConfigService;
} {
  const prisma = deps.prisma ?? makePrisma();
  const redis = deps.redis ?? makeRedis();
  const metrics = deps.metrics ?? makeMetrics();
  const coreQueue = deps.coreQueue ?? makeCoreQueue();
  const pending = deps.pending ?? makePending();
  const cfg = deps.cfg ?? makeCfg();
  const cron = new ExecMorningPushCron(
    prisma as unknown as PrismaService,
    cfg,
    redis,
    coreQueue,
    pending,
    metrics,
  );
  return { cron, prisma, redis, metrics, coreQueue, pending, cfg };
}

const makeMembershipRow = (userId: string, orgId: string) => ({ userId, orgId });

const NOW_AT_MSK_9 = new Date(Date.UTC(2026, 4, 24, 6, 0, 0));
const NOW_AT_MSK_10 = new Date(Date.UTC(2026, 4, 24, 7, 0, 0));

describe('ExecMorningPushCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('утреннее окно + N>0 + NX взят → enqueuePushSend, delivered=1', async () => {
    const prisma = makePrisma();
    prisma.membership.findMany.mockResolvedValueOnce([makeMembershipRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const pending = makePending(3);
    const { cron, coreQueue, metrics } = makeCron({ prisma, pending });

    const stats = await cron.runOnce(NOW_AT_MSK_9);

    expect(stats.delivered).toBe(1);
    expect(stats.processed).toBe(1);
    expect(coreQueue.enqueuePushSend).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        userId: 'user-1',
        body: expect.stringContaining('Требует тебя'),
        data: expect.objectContaining({ url: '/dashboard' }),
      }),
    );
    expect(metrics.incExecMorningPushDelivered).toHaveBeenCalledWith({
      channel: 'webpush',
    });
  });

  it('N===0 → enqueuePushSend НЕ вызван (skippedEmpty)', async () => {
    const prisma = makePrisma();
    prisma.membership.findMany.mockResolvedValueOnce([makeMembershipRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const pending = makePending(0);
    const { cron, coreQueue } = makeCron({ prisma, pending });

    const stats = await cron.runOnce(NOW_AT_MSK_9);

    expect(stats.skippedEmpty).toBe(1);
    expect(stats.delivered).toBe(0);
    expect(coreQueue.enqueuePushSend).not.toHaveBeenCalled();
  });

  it('вне утреннего окна (10:00 MSK) → skippedOutsideWindow, без Redis/getCount/enqueue', async () => {
    const prisma = makePrisma();
    prisma.membership.findMany.mockResolvedValueOnce([makeMembershipRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const pending = makePending(5);
    const { cron, redis, coreQueue } = makeCron({ prisma, pending });

    const stats = await cron.runOnce(NOW_AT_MSK_10);

    expect(stats.skippedOutsideWindow).toBe(1);
    expect(stats.delivered).toBe(0);
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(pending.getCount).not.toHaveBeenCalled();
    expect(coreQueue.enqueuePushSend).not.toHaveBeenCalled();
  });

  it('killswitch OFF → ранний выход run(), enqueue не вызван', async () => {
    const prisma = makePrisma();
    prisma.membership.findMany.mockResolvedValueOnce([makeMembershipRow('user-1', 'org-1')]);
    const pending = makePending(3);
    const cfg = makeCfg(false);
    const { cron, coreQueue, redis } = makeCron({ prisma, pending, cfg });

    await cron.run();

    expect(coreQueue.enqueuePushSend).not.toHaveBeenCalled();
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });

  it('NX вернул null (уже отправлено сегодня) → skippedAlreadyDelivered, без getCount/enqueue', async () => {
    const prisma = makePrisma();
    prisma.membership.findMany.mockResolvedValueOnce([makeMembershipRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const redis = makeRedis(null);
    const pending = makePending(3);
    const { cron, coreQueue } = makeCron({ prisma, redis, pending });

    const stats = await cron.runOnce(NOW_AT_MSK_9);

    expect(stats.skippedAlreadyDelivered).toBe(1);
    expect(stats.delivered).toBe(0);
    expect(pending.getCount).not.toHaveBeenCalled();
    expect(coreQueue.enqueuePushSend).not.toHaveBeenCalled();
    const setCall = vi.mocked(redis.client.set).mock.calls[0];
    expect(setCall?.[0]).toContain('exec-morning-push:org-1:user-1:2026-05-24');
  });
});
