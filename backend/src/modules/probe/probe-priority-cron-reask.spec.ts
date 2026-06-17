/**
 * Probe Ф5 re-ask (2026-06-17, решение владельца Р3) — ProbePriorityCron.
 *
 * Контракт: при истечении неотвеченного probe делается РОВНО ОДИН переспрос
 * (переформулировав), затем — закрытие как ignored.
 *
 *   - первый раз без ответа (reaskCount 0/нет) + флаг ON → создан новый
 *     ProbeEvent (status='pending', payload.reaskCount=1, originalProbeEventId),
 *     enqueue вызван, исходный `expired`, ignored НЕ инкрементнут для него;
 *   - повторный (reaskCount≥1) → `expired` + ignored, нового probe нет;
 *   - флаг OFF → `expired` + ignored, нового probe нет.
 *
 * Все Prisma/Redis/Cfg/Queue/Metrics мокированы (без БД, без сети).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';

import { ProbePriorityCron } from './probe-priority.cron';

interface ExpiredRow {
  id: string;
  dispatchedNotificationId: string | null;
  reason: string;
  tenantId: string;
  contentHash: string;
  payload: Record<string, unknown>;
  recipientCandidates: string[];
  priority: number;
  emittedByService: string;
}

function buildRow(overrides: Partial<ExpiredRow> = {}): ExpiredRow {
  return {
    id: 'probe-src-1',
    dispatchedNotificationId: null,
    reason: 'decision.overdue',
    tenantId: 'org-1',
    contentHash: 'hash-1',
    payload: {},
    recipientCandidates: ['user-1', 'user-2'],
    priority: 60,
    emittedByService: '3-3-decisions',
    ...overrides,
  };
}

interface Mocks {
  prisma: PrismaService;
  metrics: BusinessMetricsService;
  redis: RedisService;
  cfg: TypedConfigService;
  queue: CoreQueueService;
  createCalls: Array<{ data: Record<string, unknown> }>;
  enqueue: ReturnType<typeof vi.fn>;
}

function makeMocks(args: { rows: ExpiredRow[]; reaskEnabled?: boolean }): Mocks {
  const createCalls: Array<{ data: Record<string, unknown> }> = [];

  const prisma = {
    probeEvent: {
      findMany: vi.fn().mockResolvedValue(args.rows),
      updateMany: vi
        .fn()
        .mockImplementation(async (p: { where: { id: { in: string[] } } }) => ({
          count: p.where.id.in.length,
        })),
      create: vi
        .fn()
        .mockImplementation(async (p: { data: Record<string, unknown> }) => {
          createCalls.push(p);
          return { id: 'probe-reask-new' };
        }),
    },
    // respondedAt всегда null (dispatchedNotificationId=null → даже не зовётся).
    notification: {
      findUnique: vi.fn().mockResolvedValue({ respondedAt: null }),
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;

  const metrics = {
    incProbeExpired: vi.fn(),
    incProbeOutcome: vi.fn(),
    incProbeEvent: vi.fn(),
    setProbeRecipientEngagementRate: vi.fn(),
  } as unknown as BusinessMetricsService;

  const redis = {
    client: {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
    },
  } as unknown as RedisService;

  const reaskEnabled = args.reaskEnabled ?? true;
  const cfg = {
    probe: { expiryDays: 3 },
    getDynamic: vi.fn().mockImplementation(
      async (key: string, _env: unknown, fallback: unknown) => {
        if (key === 'probe.reaskEnabled') return reaskEnabled;
        if (key === 'probe.topicCooldownHours') return 48;
        return fallback;
      },
    ),
  } as unknown as TypedConfigService;

  const enqueue = vi.fn().mockResolvedValue({ jobId: 'probe_x' });
  const queue = {
    enqueueProbeEvent: enqueue,
  } as unknown as CoreQueueService;

  return { prisma, metrics, redis, cfg, queue, createCalls, enqueue };
}

function makeCron(m: Mocks): ProbePriorityCron {
  return new ProbePriorityCron(m.prisma, m.metrics, m.redis, m.cfg, m.queue);
}

describe('ProbePriorityCron — Probe Ф5 re-ask (один переспрос)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('первый раз без ответа + флаг ON → создан переспрос (reaskCount=1, originalProbeEventId), enqueue, без ignored', async () => {
    const src = buildRow({ id: 'probe-src-1', payload: { message: 'контекст' } });
    const m = makeMocks({ rows: [src], reaskEnabled: true });
    const cron = makeCron(m);

    await cron.sweep();

    // исходный истёк (метрика expired)
    expect(m.metrics.incProbeExpired).toHaveBeenCalledTimes(1);
    // создан ровно один переспрос
    expect(m.createCalls).toHaveLength(1);
    const data = m.createCalls[0]!.data;
    expect(data.status).toBe('pending');
    expect(data).toEqual(
      expect.objectContaining({
        reason: 'decision.overdue',
        contentHash: 'hash-1',
        priority: 60,
        emittedByService: '3-3-decisions',
      }),
    );
    expect(data.payload).toEqual(
      expect.objectContaining({
        message: 'контекст',
        reaskCount: 1,
        originalProbeEventId: 'probe-src-1',
      }),
    );
    // переспрос поставлен в очередь dispatcher'а
    expect(m.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ probeEventId: 'probe-reask-new' }),
    );
    // ignored для переспрошенного НЕ инкрементнут
    expect(m.metrics.incProbeOutcome).not.toHaveBeenCalled();
  });

  it('повторный (payload.reaskCount=1) → expired + ignored, нового probe не создаёт', async () => {
    const src = buildRow({ id: 'probe-src-2', payload: { reaskCount: 1 } });
    const m = makeMocks({ rows: [src], reaskEnabled: true });
    const cron = makeCron(m);

    await cron.sweep();

    expect(m.metrics.incProbeExpired).toHaveBeenCalledTimes(1);
    expect(m.metrics.incProbeOutcome).toHaveBeenCalledWith({
      outcome: 'ignored',
      reason: 'decision.overdue',
    });
    expect(m.createCalls).toHaveLength(0);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it('флаг OFF → expired + ignored, переспрос НЕ создаётся', async () => {
    const src = buildRow({ id: 'probe-src-3', payload: {} });
    const m = makeMocks({ rows: [src], reaskEnabled: false });
    const cron = makeCron(m);

    await cron.sweep();

    expect(m.metrics.incProbeExpired).toHaveBeenCalledTimes(1);
    expect(m.metrics.incProbeOutcome).toHaveBeenCalledWith({
      outcome: 'ignored',
      reason: 'decision.overdue',
    });
    expect(m.createCalls).toHaveLength(0);
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});
