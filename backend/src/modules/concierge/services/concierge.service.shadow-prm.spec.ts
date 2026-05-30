/**
 * Agents v2 Фаза B2 (2026-05-30) — Integration test для shadow PRM режима
 * `ConciergeService.process()`:
 *
 *   - флаг включён (`CONCIERGE_PRM_SHADOW_ENABLED=true`);
 *   - mock LlmRouter возвращает tool_call(A) на первой итерации, затем
 *     tool_call(B), tool_call(C) на доп. вызовах (top-K diversity), затем
 *     `{score: ...}` на scoring-вызовах, затем финальный текст;
 *   - ConciergeStepScore записан с правильными полями;
 *   - Concierge выполнил tool_call(A) — то, что выбрал LLM (НЕ PRM-top-1).
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { DialogService } from '../../dialog-layer/services/dialog.service';

import type { ConciergeContextBuilderService } from './concierge-context-builder.service';
import type { ConciergeQuotaService } from './concierge-quota.service';
import type { ConciergeUndoLogService } from './concierge-undo-log.service';
import {
  ConciergeService,
  type ConciergeStreamEvent,
} from './concierge.service';
import type { ServiceMapGeneratorService } from './service-map-generator.service';
import { ConciergeStepScorerService } from './step-scorer.service';
import type { ToolRouterService } from './tool-router.service';

async function collect(
  stream: AsyncIterable<ConciergeStreamEvent>,
): Promise<ConciergeStreamEvent[]> {
  const out: ConciergeStreamEvent[] = [];
  for await (const ev of stream) {
    out.push(ev);
  }
  return out;
}

interface ShadowOpts {
  /** Последовательность ответов LLM. Index 0 — основной вызов; 1..K-1 — alt
   *  кандидаты; далее — scoring (по `concierge-step-prm`); далее — финал. */
  llmResponses: string[];
}

function buildShadowConciergeService(opts: ShadowOpts) {
  const conversationId = 'conv-shadow-1';
  const messageId = 'msg-shadow-1';

  // По taskType разруливаем: 'concierge-respond' vs 'concierge-step-prm'.
  // Очередь ответов для respond: первое + альтернативные. Для PRM — оставшиеся.
  const respondQueue: string[] = [];
  const prmQueue: string[] = [];
  // По умолчанию: первые 3 — respond (top-1 + 2 alt), потом 3 — PRM scoring,
  // потом — финальный текст respond. Caller передаёт все ответы в порядке вызова.
  // Здесь делаем простой round-robin по taskType — каждый вызов берёт следующий
  // из соответствующей очереди.
  for (const r of opts.llmResponses) {
    if (
      r.includes('"score"') ||
      r.startsWith('PRM_SCORING')
    ) {
      // Маркер: ответ PRM-scoring.
      prmQueue.push(r.replace(/^PRM_SCORING:/, ''));
    } else {
      respondQueue.push(r);
    }
  }

  const llmCall = vi.fn(async (args: { taskType: string }) => {
    let text: string;
    if (args.taskType === 'concierge-step-prm') {
      text = prmQueue.shift() ?? '{"score": 0, "reasoning": "queue empty"}';
    } else {
      text = respondQueue.shift() ?? 'Финальный ответ по умолчанию';
    }
    return {
      text,
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    };
  });

  const messageCreate = vi.fn(
    async ({ data }: { data: { role: string } }) => ({
      id: data.role === 'tool' ? messageId : `${data.role}-msg-id`,
      conversationId,
      role: data.role,
      content: '',
      toolCallsJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );

  const stepScoreCreate = vi.fn(async ({ data }: { data: unknown }) => ({
    id: 'step-score-1',
    ...(data as Record<string, unknown>),
  }));

  const prisma = {
    conciergeConversation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({
        id: conversationId,
        tenantId: 't-1',
        userId: 'u-1',
        summary: null,
        pageContextJson: null,
        lastMessageAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conciergeMessage: {
      create: messageCreate,
      findMany: vi.fn(async () => []),
    },
    conciergeStepScore: {
      create: stepScoreCreate,
    },
  } as unknown as PrismaService;

  const cfg = {
    concierge: {
      enabled: true,
      dailyMessagesLimit: 100,
      monthlyMessagesLimit: 3000,
      sseHeartbeatSeconds: 15,
      dialogLayerEnabled: false,
      preRetrievalTopK: 12,
      preRetrievalTimeoutMs: 3000,
      prmShadowEnabled: true,
      prmEnabled: false,
      prmTopK: 3,
      prmShadowSampleRate: 1.0,
    },
  } as unknown as TypedConfigService;

  const llm = { call: llmCall } as unknown as LlmRouterService;
  const contextBuilder = {
    build: vi.fn(async () => ''),
  } as unknown as ConciergeContextBuilderService;
  const serviceMap = {
    buildToolUsePromptFragment: vi.fn(() => '[]'),
    findTool: vi.fn(() => ({ method: 'GET', undoableVia: null })),
  } as unknown as ServiceMapGeneratorService;
  const toolRouter = {
    execute: vi.fn(async () => ({
      ok: true,
      status: 200,
      result: { items: [] },
      tool: { name: 'search_meetings' },
    })),
  } as unknown as ToolRouterService;
  const undoLog = {
    record: vi.fn(),
  } as unknown as ConciergeUndoLogService;
  const quota = {
    tryConsume: vi.fn(async () => null),
  } as unknown as ConciergeQuotaService;

  const metricsIncConciergeMessage = vi.fn();
  const metricsIncConciergePrmAgreement = vi.fn();
  const metricsIncConciergePrmLlmRank = vi.fn();
  const metricsObserveConciergePrmScore = vi.fn();
  const metrics = {
    incConciergeMessage: metricsIncConciergeMessage,
    incConciergePrmAgreement: metricsIncConciergePrmAgreement,
    incConciergePrmLlmRank: metricsIncConciergePrmLlmRank,
    observeConciergePrmScore: metricsObserveConciergePrmScore,
  } as unknown as BusinessMetricsService;

  const dialog = null as unknown as DialogService | null;
  const stepScorer = new ConciergeStepScorerService(llm);

  const svc = new ConciergeService(
    prisma,
    cfg,
    llm,
    contextBuilder,
    serviceMap,
    toolRouter,
    undoLog,
    quota,
    metrics,
    dialog,
    stepScorer,
  );

  return {
    svc,
    mocks: {
      llmCall,
      stepScoreCreate,
      toolRouter,
      metricsIncConciergePrmAgreement,
      metricsIncConciergePrmLlmRank,
      metricsObserveConciergePrmScore,
    },
  };
}

describe('ConciergeService — PRM shadow mode (Фаза B2)', () => {
  it('shadow включён: LLM выбирает tool A, PRM оценивает A/B/C, в БД ConciergeStepScore с prmAgreed корректно', async () => {
    // Сценарий:
    //   - LLM respond #1 (top-1): tool_call A (search_meetings, args1).
    //   - LLM respond #2/#3 (alt): tool_call B (calendar, args2), C (notes).
    //   - LLM scoring x3: scores A=0.4, B=0.9, C=0.2.
    //     → PRM top-1 = B → prmAgreed=false, selectedRank=2 (A).
    //   - LLM respond #4 (после tool result): финальный текст.
    const { svc, mocks } = buildShadowConciergeService({
      llmResponses: [
        // respond #1 — LLM top-1.
        '{"tool_call":{"name":"search_meetings","arguments":{"from":"2026-05-31"}}}',
        // respond #2/#3 — alt candidates.
        '{"tool_call":{"name":"calendar","arguments":{"day":"2026-05-31"}}}',
        '{"tool_call":{"name":"notes","arguments":{"q":"завтра"}}}',
        // PRM scoring — 3 кандидата, score'ы низкие/высокие.
        'PRM_SCORING:{"score": 0.4, "reasoning": "ничего"}',
        'PRM_SCORING:{"score": 0.9, "reasoning": "лучший выбор"}',
        'PRM_SCORING:{"score": 0.2, "reasoning": "не то"}',
        // respond #4 — финальный текст после tool result.
        'Готово, нашёл встречи.',
      ],
    });

    const events = await collect(
      svc.process({
        userMessage: 'Сколько встреч завтра?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // 1. Concierge выполнил то, что выбрал LLM — search_meetings (top-1 LLM).
    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    expect(toolCallEvent).toBeDefined();
    expect(
      toolCallEvent && toolCallEvent.type === 'tool_call' && toolCallEvent.toolName,
    ).toBe('search_meetings');

    // 2. ToolRouter был вызван с tool A (НЕ PRM-top B!).
    const execMock = mocks.toolRouter.execute as ReturnType<typeof vi.fn>;
    expect(execMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'search_meetings' }),
    );
    expect(execMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'calendar' }),
    );

    // 3. ConciergeStepScore.create вызван 1 раз.
    expect(mocks.stepScoreCreate).toHaveBeenCalledTimes(1);
    const createCall = mocks.stepScoreCreate.mock.calls[0]?.[0] as {
      data: {
        selectedTool: { toolName: string };
        alternatives: Array<{ toolName: string; score: number }>;
        selectedScore: number;
        selectedRank: number;
        llmChoseRank: number;
        prmAgreed: boolean;
        promotedToActive: boolean;
        tenantId: string;
      };
    };
    expect(createCall.data.tenantId).toBe('t-1');
    expect(createCall.data.selectedTool.toolName).toBe('search_meetings');
    // alternatives отсортированы по PRM-score desc: B(0.9) → A(0.4) → C(0.2).
    expect(createCall.data.alternatives[0]?.toolName).toBe('calendar');
    expect(createCall.data.alternatives[0]?.score).toBeCloseTo(0.9);
    expect(createCall.data.selectedScore).toBeCloseTo(0.4);
    expect(createCall.data.selectedRank).toBe(2); // A на втором месте по PRM
    expect(createCall.data.llmChoseRank).toBe(2);
    expect(createCall.data.prmAgreed).toBe(false); // top-1 LLM ≠ top-1 PRM
    expect(createCall.data.promotedToActive).toBe(false);

    // 4. Метрики обновлены.
    expect(mocks.metricsIncConciergePrmAgreement).toHaveBeenCalledWith({
      agreed: 'false',
    });
    expect(mocks.metricsIncConciergePrmLlmRank).toHaveBeenCalledWith({
      rank: '2',
    });
    // 3 кандидата → 3 observation на score histogram.
    expect(mocks.metricsObserveConciergePrmScore).toHaveBeenCalledTimes(3);
  });

  it('shadow выключен (флаг false): PRM не вызывается, ConciergeStepScore не пишется', async () => {
    // Используем тот же builder, но переопределим флаг.
    const { svc, mocks } = buildShadowConciergeService({
      llmResponses: [
        '{"tool_call":{"name":"search_meetings","arguments":{"from":"2026-05-31"}}}',
        'Готово.',
      ],
    });
    // Hack: переопределяем cfg.concierge.prmShadowEnabled через property
    // на свежем объекте (svc уже создан).
    (svc as unknown as { cfg: { concierge: { prmShadowEnabled: boolean } } })
      .cfg.concierge.prmShadowEnabled = false;

    await collect(
      svc.process({
        userMessage: 'Сколько встреч завтра?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(mocks.stepScoreCreate).not.toHaveBeenCalled();
    // PRM scoring не должен был вызываться.
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ taskType: string }>
    >;
    const prmCalls = llmCalls.filter(
      (call) => call[0]?.taskType === 'concierge-step-prm',
    );
    expect(prmCalls).toHaveLength(0);
  });
});
