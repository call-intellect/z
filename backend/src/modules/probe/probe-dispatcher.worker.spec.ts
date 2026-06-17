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
function buildProbe(
  payload: Record<string, unknown>,
  priority = 80,
  reason = 'decision.confirm_status',
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
  };
}

function makeMocks(args: {
  probePayload: Record<string, unknown>;
  llmResponse?: { text: string };
  llmThrow?: Error;
  probePriority?: number;
  reason?: string;
  /**
   * Probe Фаза 2 — ответ LLM-судьи качества (`probe-quality-judge`), вызов
   * ИДЁТ ВТОРЫМ после probe-formulate. По умолчанию `{ok:true}` (вопрос
   * полноценный, исходный сохраняется), чтобы старые dispatch-тесты не задевал
   * регенерат. Передай свой judgeResponse/judgeThrow для тестов Ф2.
   */
  judgeResponse?: { text: string };
  judgeThrow?: Error;
  qualityJudgeEnabled?: boolean;
}): Mocks {
  const probe = buildProbe(args.probePayload, args.probePriority, args.reason);
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

  // Очередь LLM-вызовов: [0] probe-formulate, [1] probe-quality-judge.
  const llmCall = vi.fn();
  if (args.llmThrow) {
    llmCall.mockRejectedValueOnce(args.llmThrow);
  } else if (args.llmResponse) {
    llmCall.mockResolvedValueOnce(args.llmResponse);
  }
  // Второй вызов — судья качества (если флаг не выключен и reason не CDM).
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

  const probeService = {
    filterByRateLimit: vi.fn().mockResolvedValue(['user-1']),
    noteSent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProbeService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeDispatched: vi.fn(),
    incProbeRateLimitDropped: vi.fn(),
    incProbeExpired: vi.fn(),
    incProbeQualityJudged: vi.fn(),
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
    aiFeatures: { promptInjectionGuardEnabled: false },
    // Динамические крутилки (probe.immediatePushMinPriority=70,
    // probe.topicCooldownHours=48) — мок отдаёт переданный fallback. Для
    // probe.qualityJudgeEnabled можно переопределить через qualityJudgeEnabled.
    getDynamic: vi
      .fn()
      .mockImplementation(
        async (key: string, _env: unknown, fallback: unknown) => {
          if (
            key === 'probe.qualityJudgeEnabled' &&
            args.qualityJudgeEnabled !== undefined
          ) {
            return args.qualityJudgeEnabled;
          }
          return fallback;
        },
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

    // 2 LLM-вызова: probe-formulate + probe-quality-judge (Ф2, флаг ON).
    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
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

/**
 * TZ clone-method Э3.1 — CDM-вопрос НЕ переформулируется: он уже построен
 * LLM `cdm-case-interview` строго по методике критических решений (открытый,
 * не наводящий); прогон через probe-formulate мог бы сделать его наводящим.
 */
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

    // LLM probe-formulate не дёргался.
    expect(mocks.llmCall).not.toHaveBeenCalled();
    // Вопрос сохранён без изменений.
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

/**
 * Probe Фаза 2 (2026-06-17) — LLM-судья качества формулировки + один регенерат.
 * Судья вызывается ВТОРЫМ LLM-вызовом после probe-formulate. При браке и валидном
 * rewrite → отправляется регенерат; иначе/при сбое → исходный (best-effort).
 */
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

    // sendNotification получил rewrite, а не исходный вопрос.
    expect(
      vi.mocked(mocks.conversational.sendNotification),
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          question: 'Кто отвечает за это решение?',
        }),
      }),
    );
    // В payload ProbeEvent сохранён тот же rewrite.
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

    // Только один LLM-вызов (probe-formulate); судья не дёргался.
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
