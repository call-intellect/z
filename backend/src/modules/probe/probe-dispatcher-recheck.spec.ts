import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { ConversationalService } from '../conversational/conversational.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';
import type { ProbeEventJobData } from '../core-queue/queues';

import { ProbeDispatcherWorker } from './probe-dispatcher.worker';
import { ProbeFormulationService } from './probe-formulation.service';
import type { ProbeService } from './probe.service';

function buildProbe() {
  return {
    id: 'probe-recheck-1',
    tenantId: 'org-1',
    emittedByService: '3-3-decisions',
    reason: 'decision.missing_decider',
    payload: { contextCardId: 'dec-1', contextCardKind: 'decision' },
    recipientCandidates: ['user-1'],
    selectedRecipientId: null,
    status: 'pending',
    dispatchedNotificationId: null,
    contentHash: 'h',
    priority: 80,
    createdAt: new Date(Date.now() - 60_000),
    dispatchedAt: null,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
    notBeforeAt: null,
  };
}

function makeWorker(args: { decisionFindFirst: ReturnType<typeof vi.fn> }): {
  worker: ProbeDispatcherWorker;
  updateCalls: Array<{ data: Record<string, unknown> }>;
  sendNotification: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
} {
  const probe = buildProbe();
  const updateCalls: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    probeEvent: {
      findUnique: vi.fn().mockResolvedValue(probe),
      update: vi.fn().mockImplementation(async (p: { data: Record<string, unknown> }) => {
        updateCalls.push(p);
        return { ...probe, ...p.data };
      }),
    },
    decision: { findFirst: args.decisionFindFirst },
  } as unknown as PrismaService;

  const llmCall = vi
    .fn()
    .mockResolvedValue({ text: JSON.stringify({ question: 'Кто отвечает за решение?' }) });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const sendNotification = vi.fn().mockResolvedValue({ id: 'notif-1' });
  const conversational = { sendNotification } as unknown as ConversationalService;

  const probeService = {
    filterByRateLimit: vi.fn().mockResolvedValue(['user-1']),
    noteSent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProbeService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeDispatched: vi.fn(),
    incProbeRateLimitDropped: vi.fn(),
    incProbeExpired: vi.fn(),
    // Ф2 (2026-06-17) — судья качества пишет эту метрику на dispatch-пути.
    incProbeQualityJudged: vi.fn(),
    incProbeValueGate: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    probe: {},
    getDynamic: vi
      .fn()
      .mockImplementation(async (_key: string, _env: unknown, fallback: unknown) => fallback),
  } as unknown as TypedConfigService;

  const redis = { client: {} } as unknown as RedisService;

  const queue = {
    enqueueProbeEvent: vi.fn().mockResolvedValue({ jobId: 'probe_probe-recheck-1' }),
  } as unknown as CoreQueueService;

  const formulation = new ProbeFormulationService(llm, metrics, cfg);
  const worker = new ProbeDispatcherWorker(
    redis,
    prisma,
    conversational,
    probeService,
    metrics,
    cfg,
    formulation,
    queue,
  );
  return { worker, updateCalls, sendNotification, llmCall };
}

async function run(worker: ProbeDispatcherWorker): Promise<void> {
  const job = {
    data: { probeEventId: 'probe-recheck-1' } as ProbeEventJobData,
    attemptsMade: 1,
  } as unknown as Job<ProbeEventJobData>;
  // @ts-expect-error — namespaced private method вызываем напрямую
  await worker.process(job);
}

describe('ProbeDispatcherWorker — recheck повода (Фаза 4)', () => {
  it('пробел закрылся (решающий назначен) → suppressed_stale, не шлём', async () => {
    const env = makeWorker({
      decisionFindFirst: vi
        .fn()
        .mockResolvedValue({ decidedByPersonIds: ['p1'], decidedByPersonId: null }),
    });
    await run(env.worker);

    const statuses = env.updateCalls.map((c) => c.data.status);
    expect(statuses).toContain('suppressed_stale');
    expect(env.sendNotification).not.toHaveBeenCalled();
    expect(env.llmCall).not.toHaveBeenCalled();
  });

  it('пробел открыт (решающего нет) → probe отправляется', async () => {
    const env = makeWorker({
      decisionFindFirst: vi
        .fn()
        .mockResolvedValue({ decidedByPersonIds: [], decidedByPersonId: null }),
    });
    await run(env.worker);

    expect(env.sendNotification).toHaveBeenCalledTimes(1);
    const statuses = env.updateCalls.map((c) => c.data.status);
    expect(statuses).toContain('dispatched');
    expect(statuses).not.toContain('suppressed_stale');
  });

  it('предикат упал → best-effort: probe всё равно отправляется', async () => {
    const env = makeWorker({
      decisionFindFirst: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await run(env.worker);

    expect(env.sendNotification).toHaveBeenCalledTimes(1);
    const statuses = env.updateCalls.map((c) => c.data.status);
    expect(statuses).not.toContain('suppressed_stale');
    expect(statuses).toContain('dispatched');
  });
});
