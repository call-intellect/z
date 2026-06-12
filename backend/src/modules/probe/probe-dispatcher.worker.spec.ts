/**
 * Agents v2 Фаза 0.2 (2026-05-30) — ProbeDispatcherWorker.
 *
 * Unit-тест: после успешного `formulate()` worker сохраняет
 * formulatedQuestion в `ProbeEvent.payload`, чтобы потом
 * `ProbeResponseHandler` мог отдать его LLM-классификатору
 * (`probe-response-classify`) вместо reason/message-fallback'a.
 *
 * Все Prisma/LLM/Conversational/Probe/Metrics/Cfg мокированы (без БД, без сети).
 */

import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { ConversationalService } from '../conversational/conversational.service';
import type { ProbeEventJobData } from '../core-queue/queues';

import { ProbeDispatcherWorker } from './probe-dispatcher.worker';
import type { ProbeService } from './probe.service';

interface Mocks {
  prisma: PrismaService;
  llm: LlmRouterService;
  conversational: ConversationalService;
  probeService: ProbeService;
  metrics: BusinessMetricsService;
  cfg: TypedConfigService;
  redis: RedisService;
  updateCalls: Array<{ where: unknown; data: Record<string, unknown> }>;
  llmCall: ReturnType<typeof vi.fn>;
}

/**
 * Дефолтный priority=80 — выше порога immediatePushMinPriority (70, Autonomy
 * W0 Ф0.2), чтобы тесты dispatch-пути не задевал priority-гейт.
 */
function buildProbe(payload: Record<string, unknown>, priority = 80) {
  return {
    id: 'probe-disp-1',
    tenantId: 'org-disp',
    emittedByService: '3-3-decisions',
    reason: 'decision.confirm_status',
    payload,
    recipientCandidates: ['user-1'],
    selectedRecipientId: null,
    status: 'pending',
    dispatchedNotificationId: null,
    contentHash: 'h',
    priority,
    createdAt: new Date(Date.now() - 60_000),
    dispatchedAt: null,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  };
}

function makeMocks(args: {
  probePayload: Record<string, unknown>;
  llmResponse?: { text: string };
  llmThrow?: Error;
  probePriority?: number;
}): Mocks {
  const probe = buildProbe(args.probePayload, args.probePriority);
  const updateCalls: Array<{
    where: unknown;
    data: Record<string, unknown>;
  }> = [];

  const prisma = {
    probeEvent: {
      findUnique: vi.fn().mockResolvedValue(probe),
      update: vi
        .fn()
        .mockImplementation(
          async (params: { where: unknown; data: Record<string, unknown> }) => {
            updateCalls.push(params);
            return { ...probe, ...params.data };
          },
        ),
    },
  } as unknown as PrismaService;

  const llmCall = vi.fn();
  if (args.llmThrow) {
    llmCall.mockRejectedValueOnce(args.llmThrow);
  } else if (args.llmResponse) {
    llmCall.mockResolvedValueOnce(args.llmResponse);
  }
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const conversational = {
    sendNotification: vi.fn().mockResolvedValue({ id: 'notif-disp-1' }),
  } as unknown as ConversationalService;

  const probeService = {
    filterByRateLimit: vi.fn().mockResolvedValue(['user-1']),
    noteSent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProbeService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeDispatched: vi.fn(),
    incProbeRateLimitDropped: vi.fn(),
    incProbeExpired: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    probe: {
      dedupTtlHours: 24,
      expiryDays: 3,
      coldStartModeHours: 0,
      rateLimitPerHour: 5,
      rateLimitPerDay: 20,
      responseClassifyEnabled: true,
      voiceInputEnabled: true,
      responseClassifyMinConfidence: 0.5,
    },
    // Динамические крутилки (probe.immediatePushMinPriority=70,
    // probe.topicCooldownHours=48) — мок отдаёт переданный fallback.
    getDynamic: vi
      .fn()
      .mockImplementation(
        async (_key: string, _env: unknown, fallback: unknown) => fallback,
      ),
  } as unknown as TypedConfigService;

  const redis = {
    client: {} as unknown,
  } as unknown as RedisService;

  return {
    prisma,
    llm,
    conversational,
    probeService,
    metrics,
    cfg,
    redis,
    updateCalls,
    llmCall,
  };
}

function makeWorker(m: Mocks): ProbeDispatcherWorker {
  return new ProbeDispatcherWorker(
    m.redis,
    m.prisma,
    m.llm,
    m.conversational,
    m.probeService,
    m.metrics,
    m.cfg,
  );
}

/** process — приватный; вызываем через bracket-access как в integration spec. */
async function runProcess(
  worker: ProbeDispatcherWorker,
  probeEventId: string,
): Promise<void> {
  const job = {
    data: { probeEventId } as ProbeEventJobData,
    attemptsMade: 1,
  } as unknown as Job<ProbeEventJobData>;
  // @ts-expect-error — namespaced private method вызываем напрямую
  await worker.process(job);
}

describe('ProbeDispatcherWorker — Agents v2 Фаза 0.2', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks({
      probePayload: {
        message: 'Решение по миграции на DeepSeek просрочено на 2 дня.',
        suggestedActions: ['Подтвердить', 'Отменить', 'Продлить'],
      },
      llmResponse: {
        text: JSON.stringify({
          question: 'Вы согласовали миграцию на DeepSeek с финдиректором?',
        }),
      },
    });
  });

  it('сохраняет formulatedQuestion в ProbeEvent.payload после успешного LLM probe-formulate', async () => {
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    // Должен быть ровно один update — на status='dispatched'.
    expect(mocks.updateCalls).toHaveLength(1);
    const updateData = mocks.updateCalls[0]!.data;
    expect(updateData.status).toBe('dispatched');
    expect(updateData.dispatchedNotificationId).toBe('notif-disp-1');

    const newPayload = updateData.payload as Record<string, unknown>;
    expect(newPayload.formulatedQuestion).toBe(
      'Вы согласовали миграцию на DeepSeek с финдиректором?',
    );
    // Старые поля из payload не теряются.
    expect(newPayload.message).toBe(
      'Решение по миграции на DeepSeek просрочено на 2 дня.',
    );
    expect(newPayload.suggestedActions).toEqual([
      'Подтвердить',
      'Отменить',
      'Продлить',
    ]);
  });

  it('LLM упал — formulatedQuestion = fallback (suggestedQuestion из payload)', async () => {
    mocks = makeMocks({
      probePayload: {
        message: 'Контекст из specialist-а',
        suggestedQuestion: 'Вы согласовали с финдиректором?',
        suggestedActions: ['Да', 'Нет'],
      },
      llmThrow: new Error('llm proxy 500'),
    });

    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.updateCalls).toHaveLength(1);
    const newPayload = mocks.updateCalls[0]!.data.payload as Record<
      string,
      unknown
    >;
    // formulatedQuestion = fallback = suggestedQuestion.
    expect(newPayload.formulatedQuestion).toBe(
      'Вы согласовали с финдиректором?',
    );
  });
});

describe('ProbeDispatcherWorker — Autonomy W0 Ф0.2: priority-гейт немедленного пуша', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeGateMocks(probePriority: number): Mocks {
    return makeMocks({
      probePayload: {
        message: 'Решение по миграции на DeepSeek просрочено на 2 дня.',
      },
      llmResponse: {
        text: JSON.stringify({ question: 'Подтвердите статус решения?' }),
      },
      probePriority,
    });
  }

  it('priority=40 < порога 70 → status=queued_digest, без sendNotification и без LLM formulate', async () => {
    const mocks = makeGateMocks(40);
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]!.data.status).toBe('queued_digest');
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).not.toHaveBeenCalled();
    expect(mocks.llmCall).not.toHaveBeenCalled();
  });

  it('priority=80 ≥ порога 70 → обычный dispatch (sendNotification вызван)', async () => {
    const mocks = makeGateMocks(80);
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]!.data.status).toBe('dispatched');
  });

  it('ровно на пороге priority=70 → dispatch (правило ≥ порога)', async () => {
    const mocks = makeGateMocks(70);
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]!.data.status).toBe('dispatched');
  });

  it('L-1: getDynamic упал → default 70, dispatch НЕ падает (priority=80 → dispatched)', async () => {
    const mocks = makeGateMocks(80);
    vi.mocked(mocks.cfg.getDynamic).mockImplementation(
      async (key: string, _env: unknown, fallback: unknown) => {
        if (key === 'probe.immediatePushMinPriority') {
          throw new Error('settings db down');
        }
        return fallback as never;
      },
    );
    const worker = makeWorker(mocks);

    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]!.data.status).toBe('dispatched');
  });

  it('L-1: getDynamic упал, priority=40 < default 70 → queued_digest (гейт работает на дефолте)', async () => {
    const mocks = makeGateMocks(40);
    vi.mocked(mocks.cfg.getDynamic).mockRejectedValue(
      new Error('settings db down'),
    );
    const worker = makeWorker(mocks);

    await runProcess(worker, 'probe-disp-1');

    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]!.data.status).toBe('queued_digest');
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).not.toHaveBeenCalled();
  });
});
