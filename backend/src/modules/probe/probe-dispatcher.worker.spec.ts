import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { SubjectMemoryService } from './subject-memory/subject-memory.service';

interface Mocks {
  prisma: PrismaService;
  llm: LlmRouterService;
  conversational: ConversationalService;
  probeService: ProbeService;
  metrics: BusinessMetricsService;
  cfg: TypedConfigService;
  redis: RedisService;
  queue: CoreQueueService;
  enqueue: ReturnType<typeof vi.fn>;
  updateCalls: Array<{ where: unknown; data: Record<string, unknown> }>;
  llmCall: ReturnType<typeof vi.fn>;
}

function buildProbe(
  payload: Record<string, unknown>,
  priority = 80,
  reason = 'decision.confirm_status',
  notBeforeAt: Date | null = null,
) {
  return {
    id: 'probe-disp-1',
    tenantId: 'org-disp',
    emittedByService: '3-3-decisions',
    reason,
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
    notBeforeAt,
  };
}

function makeMocks(args: {
  probePayload: Record<string, unknown>;
  llmResponse?: { text: string };
  llmThrow?: Error;
  probePriority?: number;
  reason?: string;
  judgeResponse?: { text: string };
  judgeThrow?: Error;
  qualityJudgeEnabled?: boolean;
  candidates?: string[];
  engagement?: Record<string, string>;
  engagementRoutingEnabled?: boolean;
  deliveryKind?: string | null;
  valueGateEnabled?: boolean;
  gateResponse?: { text: string };
  gateThrow?: Error;
  notBeforeAt?: Date | null;
}): Mocks {
  const probe = buildProbe(
    args.probePayload,
    args.probePriority,
    args.reason,
    args.notBeforeAt ?? null,
  );
  const updateCalls: Array<{
    where: unknown;
    data: Record<string, unknown>;
  }> = [];

  const deliveryKind = args.deliveryKind ?? null;
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
    notificationDelivery: {
      findFirst: vi.fn().mockResolvedValue(
        deliveryKind
          ? { channelBinding: { channel: { kind: deliveryKind } } }
          : null,
      ),
    },
  } as unknown as PrismaService;

  const llmCall = vi.fn();
  if (args.valueGateEnabled === true) {
    if (args.gateThrow) {
      llmCall.mockRejectedValueOnce(args.gateThrow);
    } else {
      llmCall.mockResolvedValueOnce(
        args.gateResponse ?? { text: JSON.stringify({ ask: true, reason: 'ok' }) },
      );
    }
  }
  if (args.llmThrow) {
    llmCall.mockRejectedValueOnce(args.llmThrow);
  } else if (args.llmResponse) {
    llmCall.mockResolvedValueOnce(args.llmResponse);
  }
  if (args.judgeThrow) {
    llmCall.mockRejectedValueOnce(args.judgeThrow);
  } else {
    llmCall.mockResolvedValueOnce(
      args.judgeResponse ?? { text: JSON.stringify({ ok: true, issues: [] }) },
    );
  }
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const conversational = {
    sendNotification: vi.fn().mockResolvedValue({ id: 'notif-disp-1' }),
  } as unknown as ConversationalService;

  const candidates = args.candidates ?? ['user-1'];
  const probeService = {
    filterByRateLimit: vi.fn().mockResolvedValue(candidates),
    noteSent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProbeService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeDispatched: vi.fn(),
    incProbeRateLimitDropped: vi.fn(),
    incProbeExpired: vi.fn(),
    incProbeQualityJudged: vi.fn(),
    incProbeValueGate: vi.fn(),
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
    subjectMemory: {
      enabled: false,
      retrieveBeforeAskEnabled: false,
      matchMinSimilarity: 0.82,
      suppressMinConfidence: 0.7,
    },
    aiFeatures: { promptInjectionGuardEnabled: false },
    getDynamic: vi
      .fn()
      .mockImplementation(
        async (key: string, _env: unknown, fallback: unknown) => {
          if (key === 'probe.valueGateEnabled') {
            return args.valueGateEnabled ?? false;
          }
          if (
            key === 'probe.qualityJudgeEnabled' &&
            args.qualityJudgeEnabled !== undefined
          ) {
            return args.qualityJudgeEnabled;
          }
          if (
            key === 'probe.engagementRoutingEnabled' &&
            args.engagementRoutingEnabled !== undefined
          ) {
            return args.engagementRoutingEnabled;
          }
          return fallback;
        },
      ),
  } as unknown as TypedConfigService;

  const engagement = args.engagement ?? {};
  const redis = {
    client: {
      get: vi.fn().mockImplementation(async (key: string) => {
        const userId = key.replace('probe:engagement:', '');
        return engagement[userId] ?? null;
      }),
      set: vi.fn().mockResolvedValue('OK'),
    } as unknown,
  } as unknown as RedisService;

  const enqueue = vi.fn().mockResolvedValue({ jobId: 'probe_probe-disp-1' });
  const queue = {
    enqueueProbeEvent: enqueue,
  } as unknown as CoreQueueService;

  return {
    prisma,
    llm,
    conversational,
    probeService,
    metrics,
    cfg,
    redis,
    queue,
    enqueue,
    updateCalls,
    llmCall,
  };
}

function makeWorker(m: Mocks): ProbeDispatcherWorker {
  const subjectMemory = {
    findApplicableRule: vi.fn().mockResolvedValue(null),
    findRelevantRules: vi.fn().mockResolvedValue([]),
  } as unknown as SubjectMemoryService;
  const formulation = new ProbeFormulationService(
    m.llm,
    m.metrics,
    m.cfg,
    subjectMemory,
  );
  return new ProbeDispatcherWorker(
    m.redis,
    m.prisma,
    m.conversational,
    m.probeService,
    m.metrics,
    m.cfg,
    formulation,
    m.queue,
  );
}

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

    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    expect(mocks.updateCalls).toHaveLength(1);
    const updateData = mocks.updateCalls[0]!.data;
    expect(updateData.status).toBe('dispatched');
    expect(updateData.dispatchedNotificationId).toBe('notif-disp-1');

    const newPayload = updateData.payload as Record<string, unknown>;
    expect(newPayload.formulatedQuestion).toBe(
      'Вы согласовали миграцию на DeepSeek с финдиректором?',
    );
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
    expect(newPayload.formulatedQuestion).toBe(
      'Вы согласовали с финдиректором?',
    );
  });
});

describe('ProbeDispatcherWorker — Probe Фаза 2: грейс notBeforeAt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notBeforeAt в будущем → НЕ доставляет, повторная отложенная постановка с delayMs, статус не меняется', async () => {
    const future = new Date(Date.now() + 2 * 24 * 3600_000);
    const mocks = makeMocks({
      probePayload: { message: 'Грейс на дозревание' },
      llmResponse: { text: JSON.stringify({ question: 'Не должно вызваться?' }) },
      notBeforeAt: future,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).not.toHaveBeenCalled();
    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(0);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        probeEventId: 'probe-disp-1',
        delayMs: expect.any(Number),
      }),
    );
    const arg = mocks.enqueue.mock.calls[0]![0] as { delayMs: number };
    expect(arg.delayMs).toBeGreaterThan(0);
  });

  it('notBeforeAt в прошлом → обычный dispatch (грейс созрел)', async () => {
    const past = new Date(Date.now() - 60_000);
    const mocks = makeMocks({
      probePayload: { message: 'Грейс созрел' },
      llmResponse: { text: JSON.stringify({ question: 'Кто отвечает за это?' }) },
      notBeforeAt: past,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.updateCalls[0]!.data.status).toBe('dispatched');
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

describe('ProbeDispatcherWorker — CDM-интервью (clone-method Э3.1)', () => {
  it('reason=skill.cdm_interview + suggestedQuestion → LLM probe-formulate НЕ вызывается, вопрос уходит КАК ЕСТЬ', async () => {
    const cdmQuestion =
      'Какие ещё варианты вы рассматривали, когда переносили релиз, и почему от них отказались?';
    const mocks = makeMocks({
      probePayload: {
        message: 'Вопрос + краткий контекст кейса',
        suggestedQuestion: cdmQuestion,
        contextCardId: 'profile-1',
        contextCardKind: 'skill_profile',
      },
      reason: 'skill.cdm_interview',
    });

    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(1);
    const newPayload = mocks.updateCalls[0]!.data.payload as Record<
      string,
      unknown
    >;
    expect(newPayload.formulatedQuestion).toBe(cdmQuestion);
  });

  it('reason=skill.cdm_interview БЕЗ suggestedQuestion → обычный путь probe-formulate (LLM вызван)', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'Контекст без готового вопроса' },
      reason: 'skill.cdm_interview',
      llmResponse: {
        text: JSON.stringify({ question: 'Расскажете, как принимали это решение?' }),
      },
    });

    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const newPayload = mocks.updateCalls[0]!.data.payload as Record<
      string,
      unknown
    >;
    expect(newPayload.formulatedQuestion).toBe(
      'Расскажете, как принимали это решение?',
    );
  });
});

describe('ProbeDispatcherWorker — Probe Фаза 2: LLM-судья качества', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FORMULATE_RESPONSE = {
    text: JSON.stringify({
      question: 'Уточни по cardId clx9 кто owner?',
    }),
  };

  it('судья ok=false + валидный rewrite → отправлен rewrite + метрика rewritten', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: FORMULATE_RESPONSE,
      judgeResponse: {
        text: JSON.stringify({
          ok: false,
          issues: ['has_code_or_english'],
          rewrite: 'Кто отвечает за это решение?',
        }),
      },
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          question: 'Кто отвечает за это решение?',
        }),
      }),
    );
    expect(mocks.updateCalls[0]!.data.payload).toEqual(
      expect.objectContaining({
        formulatedQuestion: 'Кто отвечает за это решение?',
      }),
    );
    expect(
      vi.mocked(mocks.metrics.incProbeQualityJudged),
    ).toHaveBeenCalledWith({ verdict: 'rewritten' });
  });

  it('судья ok=true → отправлен исходный вопрос + метрика ok', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: {
        text: JSON.stringify({ question: 'Кто отвечает за этот склад?' }),
      },
      judgeResponse: { text: JSON.stringify({ ok: true, issues: [] }) },
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          question: 'Кто отвечает за этот склад?',
        }),
      }),
    );
    expect(
      vi.mocked(mocks.metrics.incProbeQualityJudged),
    ).toHaveBeenCalledWith({ verdict: 'ok' });
  });

  it('судья кинул ошибку → отправлен исходный + метрика kept_on_fail', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: {
        text: JSON.stringify({ question: 'Кто согласовал бюджет?' }),
      },
      judgeThrow: new Error('judge proxy 500'),
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          question: 'Кто согласовал бюджет?',
        }),
      }),
    );
    expect(
      vi.mocked(mocks.metrics.incProbeQualityJudged),
    ).toHaveBeenCalledWith({ verdict: 'kept_on_fail' });
  });

  it('судья ok=false, но rewrite с латиницей/кодом → маркер-чек режет, отправлен исходный + kept_on_fail', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: {
        text: JSON.stringify({ question: 'Кто отвечает за решение?' }),
      },
      judgeResponse: {
        text: JSON.stringify({
          ok: false,
          issues: ['vague'],
          rewrite: 'Уточни owner по entity clx9f2a3b4c5d6e7f8?',
        }),
      },
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          question: 'Кто отвечает за решение?',
        }),
      }),
    );
    expect(
      vi.mocked(mocks.metrics.incProbeQualityJudged),
    ).toHaveBeenCalledWith({ verdict: 'kept_on_fail' });
  });

  it('флаг probe.qualityJudgeEnabled=false → судья не зван, отправлен исходный', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: {
        text: JSON.stringify({ question: 'Кто владелец задачи?' }),
      },
      qualityJudgeEnabled: false,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          question: 'Кто владелец задачи?',
        }),
      }),
    );
    expect(
      vi.mocked(mocks.metrics.incProbeQualityJudged),
    ).not.toHaveBeenCalled();
  });
});

describe('ProbeDispatcherWorker — Probe Фаза 3: выбор получателя по engagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FORMULATE = {
    text: JSON.stringify({ question: 'Кто отвечает за это решение?' }),
  };

  it('2 кандидата (engagement 0.2 и 0.8) → выбран более отзывчивый (0.8)', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: FORMULATE,
      candidates: ['user-low', 'user-high'],
      engagement: { 'user-low': '0.2', 'user-high': '0.8' },
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'user-high' }),
    );
    expect(mocks.updateCalls[0]!.data.selectedRecipientId).toBe('user-high');
  });

  it('равный engagement (оба 0.5/оба отсутствуют) → меньший по строковому userId (детерминизм)', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: FORMULATE,
      candidates: ['user-zzz', 'user-aaa'],
      engagement: {},
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'user-aaa' }),
    );
  });

  it('флаг probe.engagementRoutingEnabled=false → первый кандидат (candidates[0])', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: FORMULATE,
      candidates: ['user-first', 'user-high'],
      engagement: { 'user-first': '0.1', 'user-high': '0.9' },
      engagementRoutingEnabled: false,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'user-first' }),
    );
  });

  it('реальный kind: channel.kind=telegram → incProbeDispatched({kind:telegram})', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: FORMULATE,
      deliveryKind: 'telegram',
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.metrics.incProbeDispatched),
    ).toHaveBeenCalledWith(expect.objectContaining({ kind: 'telegram' }));
  });

  it('реальный kind: findFirst=null → fallback incProbeDispatched({kind:in_app})', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: FORMULATE,
      deliveryKind: null,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.metrics.incProbeDispatched),
    ).toHaveBeenCalledWith(expect.objectContaining({ kind: 'in_app' }));
  });
});

describe('ProbeDispatcherWorker — Probe Ф5: пометка переспроса в USER formulate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FORMULATE_RESP = {
    text: JSON.stringify({ question: 'Что сейчас с этим решением?' }),
  };
  const REASK_HINT = 'Это повторный вопрос';

  it('payload.reaskCount=1 → USER probe-formulate содержит пометку переспроса', async () => {
    const mocks = makeMocks({
      probePayload: {
        message: 'Решение по подрядчику просрочено.',
        reaskCount: 1,
        originalProbeEventId: 'probe-orig-1',
      },
      llmResponse: FORMULATE_RESP,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    const formulateCall = mocks.llmCall.mock.calls[0]![0] as {
      taskType: string;
      userMessage: string;
    };
    expect(formulateCall.taskType).toBe('probe-formulate');
    expect(formulateCall.userMessage).toContain(REASK_HINT);
  });

  it('payload без reaskCount → пометки переспроса в USER НЕТ', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'Решение по подрядчику просрочено.' },
      llmResponse: FORMULATE_RESP,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    const formulateCall = mocks.llmCall.mock.calls[0]![0] as {
      userMessage: string;
    };
    expect(formulateCall.userMessage).not.toContain(REASK_HINT);
  });
});

describe('ProbeDispatcherWorker — Probe Ф4: гейт ценности (value-gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('флаг probe.valueGateEnabled=false → gate БЕЗ LLM-вызова (нет probe-value-gate), обычный dispatch', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: { text: JSON.stringify({ question: 'Кто отвечает за это?' }) },
      valueGateEnabled: false,
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const taskTypes = mocks.llmCall.mock.calls.map(
      (c) => (c[0] as { taskType: string }).taskType,
    );
    expect(taskTypes).not.toContain('probe-value-gate');
    expect(taskTypes[0]).toBe('probe-formulate');
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
  });

  it('гейт ask=false → status=dropped_low_value, без formulate/judge/sendNotification', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'отчёт' },
      llmResponse: { text: JSON.stringify({ question: 'Не должно вызваться?' }) },
      valueGateEnabled: true,
      gateResponse: {
        text: JSON.stringify({ ask: false, reason: 'пустой объект' }),
      },
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const gateCall = mocks.llmCall.mock.calls[0]![0] as { taskType: string };
    expect(gateCall.taskType).toBe('probe-value-gate');
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]!.data.status).toBe('dropped_low_value');
    expect(
      vi.mocked(mocks.metrics.incProbeValueGate),
    ).toHaveBeenCalledWith({ verdict: 'skip' });
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).not.toHaveBeenCalled();
  });

  it('гейт ask=true → метрика ask + обычный путь (formulate→judge→dispatch)', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: {
        text: JSON.stringify({ question: 'Кто отвечает за этот склад?' }),
      },
      valueGateEnabled: true,
      gateResponse: { text: JSON.stringify({ ask: true, reason: 'есть объект' }) },
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.metrics.incProbeValueGate),
    ).toHaveBeenCalledWith({ verdict: 'ask' });
    expect(mocks.updateCalls[0]!.data.status).toBe('dispatched');
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
  });

  it('гейт LLM упал → fail-open ask=true, вопрос задаётся (dispatch)', async () => {
    const mocks = makeMocks({
      probePayload: { message: 'контекст' },
      llmResponse: {
        text: JSON.stringify({ question: 'Кто отвечает за это решение?' }),
      },
      valueGateEnabled: true,
      gateThrow: new Error('gate proxy 500'),
    });
    const worker = makeWorker(mocks);
    await runProcess(worker, 'probe-disp-1');

    expect(
      vi.mocked(mocks.metrics.incProbeValueGate),
    ).toHaveBeenCalledWith({ verdict: 'ask' });
    expect(mocks.updateCalls[0]!.data.status).toBe('dispatched');
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledTimes(1);
  });
});
