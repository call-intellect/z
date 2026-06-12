/**
 * Snapshot-тесты pure-функции `composeUserMessageForIteration` из
 * concierge.service.ts.
 *
 * Фиксируем формат сборки user-блока для одной итерации tool-loop в 4
 * комбинациях входных данных:
 *   (а) no summary, no history, no toolMessages;
 *   (б) summary='Юзер обсуждал миграцию X', no history, no toolMessages;
 *   (в) summary=null, history=2 сообщения, toolMessages=1;
 *   (г) summary='Юзер...', history=2 сообщения, toolMessages=1.
 *
 * Обновлять snapshot'ы только при осознанном изменении формата:
 * `bunx vitest --update`.
 *
 * ТЗ 2026-05-27 Фаза 2: ниже — отдельный describe `ConciergeService.process()`
 * с тремя ветками флага `CONCIERGE_DIALOG_LAYER_ENABLED`:
 *   (д) dialog-layer disabled — старый путь, dialog НЕ вызывается;
 *   (е) dialog-layer enabled, cache-hit — LLM не вызывается, текст из cache;
 *   (ж) dialog-layer enabled, без cache — `standaloneQuestion` подаётся в LLM.
 *
 * ТЗ 2026-05-27 Фаза 3: ниже — describe `ConciergeService.preRetrieve()` + e2e
 * проверка системного промпта с предварительными результатами:
 *   (з) preRetrieve skip для intent='clone_roleplay' — toolRouter НЕ вызывается;
 *   (и) preRetrieve дедуп по id из items[] двух query;
 *   (к) полный flow Фаза 3 — preHits попадают в userMessage (F1, было в systemPrompt) + событие thinking.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  DialogProcessResult,
  DialogService,
} from '../../dialog-layer/services/dialog.service';

import type { ConciergeContextBuilderService } from './concierge-context-builder.service';
import type { ConciergeQuotaService } from './concierge-quota.service';
import type { ConciergeUndoLogService } from './concierge-undo-log.service';
import {
  buildSystemPrompt,
  ConciergeService,
  type ConciergeStreamEvent,
  composeUserMessageForIteration,
} from './concierge.service';
import { ServiceMapGeneratorService } from './service-map-generator.service';
import type { ToolRouterService } from './tool-router.service';

describe('composeUserMessageForIteration', () => {
  it('(а) только userMessage — без summary, history, toolMessages', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Сколько у меня встреч на завтра?',
      toolMessages: [],
      history: [],
      summary: null,
    });
    expect(out).toMatchInlineSnapshot(
      `"Новый запрос пользователя: Сколько у меня встреч на завтра?"`,
    );
  });

  it('(б) summary без history и toolMessages — summary идёт первым блоком', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Продолжаем — что дальше?',
      toolMessages: [],
      history: [],
      summary: 'Юзер обсуждал миграцию X',
    });
    expect(out).toMatchInlineSnapshot(`
      "КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:
      Юзер обсуждал миграцию X

      Новый запрос пользователя: Продолжаем — что дальше?"
    `);
  });

  it('(в) history=2 + toolMessages=1, summary=null — без summary-блока', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Какой статус у задачи №42?',
      toolMessages: [
        {
          role: 'tool',
          content: 'Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}',
        },
      ],
      history: [
        { role: 'user', content: 'Покажи мои задачи' },
        { role: 'assistant', content: 'У вас 3 задачи: №42, №43, №44' },
      ],
      summary: null,
    });
    expect(out).toMatchInlineSnapshot(`
      "История диалога:
      [Пользователь] Покажи мои задачи
      [Ассистент] У вас 3 задачи: №42, №43, №44

      Результаты последних tool вызовов:
      - Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}

      Новый запрос пользователя: Какой статус у задачи №42?"
    `);
  });

  it('(г) summary + history=2 + toolMessages=1 — все три блока по порядку', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'Какой статус у задачи №42?',
      toolMessages: [
        {
          role: 'tool',
          content: 'Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}',
        },
      ],
      history: [
        { role: 'user', content: 'Покажи мои задачи' },
        { role: 'assistant', content: 'У вас 3 задачи: №42, №43, №44' },
      ],
      summary: 'Юзер ранее уточнял состояние задач Q1',
    });
    expect(out).toMatchInlineSnapshot(`
      "КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:
      Юзер ранее уточнял состояние задач Q1

      История диалога:
      [Пользователь] Покажи мои задачи
      [Ассистент] У вас 3 задачи: №42, №43, №44

      Результаты последних tool вызовов:
      - Результат tool get_task: ok=true status=200. {"id":"42","title":"Демо"}

      Новый запрос пользователя: Какой статус у задачи №42?"
    `);
  });
});

// ───────────────────────── ConciergeService.process() ─────────────────────────
//
// ТЗ 2026-05-27 Фаза 2: проверяем три ветки в зависимости от `dialogLayerEnabled`
// и наличия `DialogService` в инджекте.

interface BuildOpts {
  dialogLayerEnabled: boolean;
  dialog?: Pick<DialogService, 'process'> | null;
  llmResponseText?: string;
  conversationSummary?: string | null;
  /** Ф3 assistant-channels — native function-calling. Default false (legacy regex). */
  nativeToolsEnabled?: boolean;
}

/** Ф3 — форма мокового ответа `llm.call` (узкое подмножество LlmCallResult). */
interface MockLlmCallResult {
  text: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  toolCalls?: Array<{ name: string; input: unknown }>;
}

function buildConciergeService(opts: BuildOpts) {
  const conversationId = 'conv-1';
  const userMessageId = 'msg-user-1';
  const assistantMessageId = 'msg-asst-1';

  const llmCall = vi.fn(
    async (): Promise<MockLlmCallResult> => ({
      text: opts.llmResponseText ?? 'Финальный ответ',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    }),
  );

  const conversationCreate = vi.fn(async () => ({
    id: conversationId,
    tenantId: 't-1',
    userId: 'u-1',
    summary: opts.conversationSummary ?? null,
    pageContextJson: null,
    lastMessageAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const conversationFindFirst = vi.fn(async () => null);
  const conversationUpdate = vi.fn(async () => ({}));

  const messageCreate = vi.fn(async ({ data }: { data: { role: string } }) => ({
    id: data.role === 'assistant' ? assistantMessageId : userMessageId,
    conversationId,
    role: data.role,
    content: '',
    toolCallsJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const messageFindMany = vi.fn(async () => []);

  const prisma = {
    conciergeConversation: {
      findFirst: conversationFindFirst,
      create: conversationCreate,
      update: conversationUpdate,
      // audit С24 (2026-05-29): теперь сервис делает updateMany с tenantId.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conciergeMessage: {
      create: messageCreate,
      findMany: messageFindMany,
    },
  } as unknown as PrismaService;

  const cfg = {
    concierge: {
      enabled: true,
      dailyMessagesLimit: 100,
      monthlyMessagesLimit: 3000,
      sseHeartbeatSeconds: 15,
      dialogLayerEnabled: opts.dialogLayerEnabled,
      preRetrievalTopK: 12,
      preRetrievalTimeoutMs: 3000,
      // Ф3 — native function-calling. В unit-тестах default false (legacy
      // regex-путь); в проде default true (TypedConfigService, Ship-On).
      nativeToolsEnabled: opts.nativeToolsEnabled ?? false,
    },
  } as unknown as TypedConfigService;

  const llm = { call: llmCall } as unknown as LlmRouterService;

  const contextBuilder = {
    build: vi.fn(async () => ''),
  } as unknown as ConciergeContextBuilderService;

  // Ф6 — фикстура мини-реестра: GET-инструменты + один мутирующий без
  // undoableVia (cancel_meeting → requiresConfirm=true) + один семантически
  // безопасный POST (find_free_slot, readOnly → без confirm и undo-log).
  // toLlmTools/buildToolUsePromptFragment поддерживают опц. names (канальный
  // whitelist).
  const MOCK_TOOL_REGISTRY = [
    {
      name: 'list_tasks',
      description: 'Получить мои активные задачи',
      method: 'GET' as const,
      path: '/api/v1/tasks',
      parameters: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_person_pulse',
      description: 'Карточка сотрудника',
      method: 'GET' as const,
      path: '/api/v1/persons/:personId/pulse',
      parameters: { type: 'object' as const, properties: {} },
    },
    {
      name: 'cancel_meeting',
      description: 'Отменить встречу',
      method: 'POST' as const,
      path: '/api/v1/meetings/:id/cancel',
      parameters: { type: 'object' as const, properties: {} },
    },
    {
      name: 'find_free_slot',
      description: 'Найти общий свободный слот (чистый расчёт)',
      method: 'POST' as const,
      path: '/api/v1/events/find-free-slot',
      parameters: { type: 'object' as const, properties: {} },
      readOnly: true,
    },
  ];
  const serviceMapToLlmTools = vi.fn((names?: string[]) =>
    MOCK_TOOL_REGISTRY.filter((t) => !names || names.includes(t.name)).map(
      (t) => ({
        name: t.name,
        description: t.description,
        input_schema: { type: 'object' as const, properties: {} },
      }),
    ),
  );
  const serviceMapBuildToolUsePromptFragment = vi.fn(() => '[]');
  const serviceMap = {
    buildToolUsePromptFragment: serviceMapBuildToolUsePromptFragment,
    toLlmTools: serviceMapToLlmTools,
    findTool: vi.fn(
      (name: string) =>
        MOCK_TOOL_REGISTRY.find((t) => t.name === name) ?? null,
    ),
  } as unknown as ServiceMapGeneratorService;

  const toolRouter = {
    execute: vi.fn(),
  } as unknown as ToolRouterService;

  const undoLog = {
    record: vi.fn(),
  } as unknown as ConciergeUndoLogService;

  const quota = {
    tryConsume: vi.fn(async () => null),
  } as unknown as ConciergeQuotaService;

  // ТЗ 2026-05-31 — единая per-user квота AI-чата. Дефолтный mock пускает все
  // запросы (resolves успешно). Spec'ы могут переопределить, чтобы заставить
  // tryConsume бросить QuotaExceededError.
  const aiChatQuota = {
    tryConsume: vi.fn(async () => ({
      current: 1,
      remaining: 19,
      limit: 20,
      role: 'member',
    })),
    getUsage: vi.fn(async () => ({ dailyUsed: 0, dailyLimit: 20, role: 'member' })),
  } as unknown as import('../../ai-chat-quota/ai-chat-quota.service').AiChatQuotaService;

  const metricsIncConciergeMessage = vi.fn();
  const metricsIncConciergeDialogLayerUsed = vi.fn();
  const metricsIncConciergeCacheHit = vi.fn();
  const metricsObserveConciergePreRetrievalHits = vi.fn();
  const metrics = {
    incConciergeMessage: metricsIncConciergeMessage,
    incConciergeDialogLayerUsed: metricsIncConciergeDialogLayerUsed,
    incConciergeCacheHit: metricsIncConciergeCacheHit,
    observeConciergePreRetrievalHits: metricsObserveConciergePreRetrievalHits,
  } as unknown as BusinessMetricsService;

  const dialog = (opts.dialog ?? null) as unknown as DialogService | null;

  const svc = new ConciergeService(
    prisma,
    cfg,
    llm,
    contextBuilder,
    serviceMap,
    toolRouter,
    undoLog,
    quota,
    aiChatQuota,
    metrics,
    dialog,
  );

  return {
    svc,
    mocks: {
      llmCall,
      conversationCreate,
      conversationFindFirst,
      conversationUpdate,
      messageCreate,
      messageFindMany,
      contextBuilder,
      serviceMap,
      serviceMapToLlmTools,
      serviceMapBuildToolUsePromptFragment,
      toolRouter,
      undoLog,
      dialog: opts.dialog,
      metricsIncConciergeMessage,
      metricsIncConciergeDialogLayerUsed,
      metricsIncConciergeCacheHit,
      metricsObserveConciergePreRetrievalHits,
    },
  };
}

async function collect(
  stream: AsyncIterable<ConciergeStreamEvent>,
): Promise<ConciergeStreamEvent[]> {
  const out: ConciergeStreamEvent[] = [];
  for await (const ev of stream) {
    out.push(ev);
  }
  return out;
}

describe('ConciergeService.process() — dialog-layer integration (Фаза 2)', () => {
  it('(д) dialog-layer disabled — DialogService.process НЕ вызывается, идёт legacy путь', async () => {
    const dialogProcess = vi.fn();
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      dialog: { process: dialogProcess },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(dialogProcess).not.toHaveBeenCalled();
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    // Должны быть события started + thinking + message + done.
    const types = events.map((e) => e.type);
    expect(types).toContain('started');
    expect(types).toContain('message');
    expect(types).toContain('done');
  });

  it('(е) dialog-layer enabled + cache-hit — LLM НЕ вызывается, текст из cache', async () => {
    const dialogResult: DialogProcessResult = {
      enabled: true,
      standaloneQuestion: 'Q',
      intent: 'factual',
      queries: ['Q'],
      confidence: 1,
      cachedAnswer: {
        text: 'CACHED',
        citations: [],
        uncertaintyNote: null,
        mode: 'concierge',
        usedBlockIds: [],
        cachedAt: new Date().toISOString(),
      },
      steps: {
        contextualize: 0,
        confidence: 0,
        classify: 0,
        multiQuery: 0,
        total: 0,
      },
    };
    const dialogProcess = vi.fn(async () => dialogResult);
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: true,
      dialog: { process: dialogProcess },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Что мы решили по проекту X?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(dialogProcess).toHaveBeenCalledTimes(1);
    expect(mocks.llmCall).not.toHaveBeenCalled();

    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent).toBeDefined();
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'CACHED',
    );
    // done после message.
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('(ж) dialog-layer enabled + no cache — standaloneQuestion подаётся в LLM', async () => {
    const dialogResult: DialogProcessResult = {
      enabled: true,
      standaloneQuestion: 'РЕФОРМ',
      intent: 'factual',
      queries: ['РЕФОРМ'],
      confidence: 0.9,
      cachedAnswer: null,
      steps: {
        contextualize: 0,
        confidence: 0,
        classify: 0,
        multiQuery: 0,
        total: 0,
      },
    };
    const dialogProcess = vi.fn(async () => dialogResult);
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: true,
      dialog: { process: dialogProcess },
      llmResponseText: 'Ответ по реформулированному вопросу',
    });

    const events = await collect(
      svc.process({
        userMessage: 'а почему?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(dialogProcess).toHaveBeenCalledTimes(1);
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);

    // Проверяем, что в LLM ушёл текст с РЕФОРМ (не оригинальный «а почему?»).
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ userMessage?: string }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(llmArgs.userMessage ?? '').toContain('РЕФОРМ');
    expect(llmArgs.userMessage ?? '').not.toContain('а почему?');

    // Финальный текст идёт от LLM, не от cache.
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Ответ по реформулированному вопросу',
    );
  });
});

// ───────────────────────── ConciergeService.preRetrieve() ─────────────────────────
//
// ТЗ 2026-05-27 Фаза 3: pre-retrieval по queries[] через ToolRouter перед первой
// LLM-итерацией. Дёргаем private метод напрямую через `(svc as any).preRetrieve`.

describe('ConciergeService.preRetrieve() — Фаза 3', () => {
  it('(з) intent=clone_roleplay → skip, toolRouter.execute НЕ вызывается', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: true,
      dialog: { process: vi.fn() },
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;

    const result = await (
      svc as unknown as {
        preRetrieve: (args: {
          queries: string[];
          intent: string;
          userId: string;
          tenantId: string;
          baseUrl: string;
        }) => Promise<Array<{ query: string; result: unknown }>>;
      }
    ).preRetrieve({
      queries: ['кто я?', 'играй роль X'],
      intent: 'clone_roleplay',
      userId: 'u-1',
      tenantId: 't-1',
      baseUrl: 'http://localhost:3000',
    });

    expect(result).toEqual([]);
    expect(toolRouterExec).not.toHaveBeenCalled();
  });

  it('(и) дедуп по id из items[] двух query — `b` встречается один раз', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: true,
      dialog: { process: vi.fn() },
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { items: [{ id: 'a' }, { id: 'b' }] },
        tool: { name: 'search_knowledge' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { items: [{ id: 'b' }, { id: 'c' }] },
        tool: { name: 'search_knowledge' },
      });

    const result = await (
      svc as unknown as {
        preRetrieve: (args: {
          queries: string[];
          intent: string;
          userId: string;
          tenantId: string;
          baseUrl: string;
        }) => Promise<Array<{ query: string; result: unknown }>>;
      }
    ).preRetrieve({
      queries: ['Q1', 'Q2'],
      intent: 'factual',
      userId: 'u-1',
      tenantId: 't-1',
      baseUrl: 'http://localhost:3000',
    });

    // Соберём все id из результата.
    const allIds: string[] = [];
    for (const hit of result) {
      const items = Array.isArray(hit.result)
        ? (hit.result as Array<{ id?: unknown }>)
        : [];
      for (const it of items) {
        if (typeof it.id === 'string') allIds.push(it.id);
      }
    }
    expect(allIds.sort()).toEqual(['a', 'b', 'c']);
    expect(allIds.length).toBeLessThanOrEqual(12); // topK
  });

  it('(к) полный flow Фаза 3: preHits попадают в userMessage (F1) и в событие thinking', async () => {
    const dialogResult: DialogProcessResult = {
      enabled: true,
      standaloneQuestion: 'Что мы решили по проекту X?',
      intent: 'factual',
      queries: ['Q1', 'Q2'],
      confidence: 0.9,
      cachedAnswer: null,
      steps: {
        contextualize: 0,
        confidence: 0,
        classify: 0,
        multiQuery: 0,
        total: 0,
      },
    };
    const dialogProcess = vi.fn(async () => dialogResult);
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: true,
      dialog: { process: dialogProcess },
      llmResponseText: 'Финальный ответ по найденным данным',
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [{ id: 'item-1', title: 'X' }] },
      tool: { name: 'search_knowledge' },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Что мы решили по проекту X?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // 1. Событие thinking 'Нашёл ... релевантных записей' было.
    const thinkingEvents = events.filter(
      (e): e is { type: 'thinking'; text: string } => e.type === 'thinking',
    );
    const hadPreRetrievalThinking = thinkingEvents.some((e) => /Нашёл/.test(e.text));
    expect(hadPreRetrievalThinking).toBe(true);

    // 2. LLM был вызван хотя бы раз.
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);

    // 3. F1 cache-friendly (2026-06-10): preHits теперь в userMessage, а НЕ в
    //    systemPrompt (SYSTEM держим стабильным для prompt-cache). Проверяем,
    //    что блок ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ и item-1 доехали в user.
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ systemPrompt?: string; userMessage?: string }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(llmArgs.userMessage ?? '').toContain('ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ');
    expect(llmArgs.userMessage ?? '').toContain('item-1');
    // SYSTEM больше не содержит переменных preHits.
    expect(llmArgs.systemPrompt ?? '').not.toContain('item-1');

    // 4. toolRouter.execute дёргался под `search_knowledge` (2 queries).
    expect(toolRouterExec).toHaveBeenCalled();
    const execCalls = toolRouterExec.mock.calls as unknown as Array<
      Array<{ toolName?: string }>
    >;
    expect(execCalls.some((c) => c[0]?.toolName === 'search_knowledge')).toBe(true);
  });
});

// ───────────────────────── ConciergeService — Фаза 4 metrics ─────────────────
//
// ТЗ 2026-05-27 Фаза 4: проверяем что наблюдательные метрики дёргаются в
// нужных ветках. Cache-hit имеет свой счётчик; dialog-layer всегда инкремент
// при `dialogResult != null`; pre-retrieval histogram — при попытке pre-retrieve.

describe('ConciergeService.process() — Фаза 4 metrics', () => {
  it('(л) enabled + no cache + pre-retrieval с 2 items → dialog/preRetrieval метрики дёрнуты, cacheHit НЕ дёрнут', async () => {
    const dialogResult: DialogProcessResult = {
      enabled: true,
      standaloneQuestion: 'Что мы решили по проекту X?',
      intent: 'factual',
      queries: ['Q1', 'Q2'],
      confidence: 0.9,
      cachedAnswer: null,
      steps: {
        contextualize: 0,
        confidence: 0,
        classify: 0,
        multiQuery: 0,
        total: 0,
      },
    };
    const dialogProcess = vi.fn(async () => dialogResult);
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: true,
      dialog: { process: dialogProcess },
      llmResponseText: 'Финальный ответ',
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    // 2 query, в каждой по 1 item с разным id → totalHits=2, uniqueIds=2.
    toolRouterExec
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { items: [{ id: 'a' }] },
        tool: { name: 'search_knowledge' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { items: [{ id: 'b' }] },
        tool: { name: 'search_knowledge' },
      });

    await collect(
      svc.process({
        userMessage: 'Что мы решили по проекту X?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // dialog-layer used — ровно 1 раз с intent='factual'.
    expect(mocks.metricsIncConciergeDialogLayerUsed).toHaveBeenCalledTimes(1);
    expect(mocks.metricsIncConciergeDialogLayerUsed).toHaveBeenCalledWith({
      intent: 'factual',
    });

    // pre-retrieval histogram — дёрнут хотя бы раз (с числом ≥ 0).
    expect(mocks.metricsObserveConciergePreRetrievalHits).toHaveBeenCalled();
    const observeCalls =
      mocks.metricsObserveConciergePreRetrievalHits.mock.calls as Array<[number]>;
    const lastObserved = observeCalls[observeCalls.length - 1]?.[0] ?? -1;
    expect(typeof lastObserved).toBe('number');
    expect(lastObserved).toBeGreaterThanOrEqual(0);

    // cache-hit метрика НЕ дёрнута (cachedAnswer=null).
    expect(mocks.metricsIncConciergeCacheHit).not.toHaveBeenCalled();
  });
});

// ───────────────────────── buildSystemPrompt (Фаза 5 + F1) ─────────────────────────
//
// ТЗ 2026-05-27 Фаза 5: snapshot-тест pure-функции `buildSystemPrompt`.
// F1 cache-friendly (2026-06-10, Кластер 7-B/A8): preHits переехали из SYSTEM в
// user (`composeUserMessageForIteration`), поэтому `buildSystemPrompt` теперь
// СТАБИЛЕН и НЕ зависит от preHits. Проверяем:
//   (м) стабильный SYSTEM с контекстом и tool-fragment (без preHits);
//   (н) preHits доезжают в user-блок через `composeUserMessageForIteration`.
// Обновлять snapshot'ы только при осознанном изменении формата.

describe('buildSystemPrompt (Фаза 5 + F1 cache-friendly)', () => {
  it('(м) стабильный SYSTEM с контекстом и tool-fragment (preHits в SYSTEM больше нет)', () => {
    const out = buildSystemPrompt({
      contextBlock: 'User: Иван, Org: Acme',
      toolFragment: '[{"name":"list_meetings"}]',
    });
    // SYSTEM не содержит переменного JSON-блока preHits (только ссылку-принцип
    // на user-блок). Проверяем, что нет данных конкретного хита.
    expect(out).not.toContain('"query"');
    expect(out).not.toContain('m-1');
    expect(out).toMatchInlineSnapshot(`
      "Ты — Concierge, AI-помощник в кабинете компании Z (Кора).
      Отвечай по-русски, кратко и по делу.

      === КОНТЕКСТ ===
      User: Иван, Org: Acme

      === ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===
      Если запрос требует действия — верни ОДНУ строку строго в формате JSON:
      {"tool_call": {"name": "<имя>", "arguments": { ... }}}
      Если действие не требуется — верни просто текст ответа без JSON.
      Имя инструмента ДОЛЖНО быть из списка ниже:
      [{"name":"list_meetings"}]

      Принципы:
      - Никогда не выдумывай данные. Если не знаешь — используй search_knowledge или ask_chat_v2.
      - Если в пользовательском сообщении есть блок «=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===» — опирайся на него; если данных достаточно, отвечай без новых вызовов search_knowledge.
      - Для создания/изменения ресурсов — предпочитай tools с undoableVia (их можно отменить).
      - Если необходимо подтверждение пользователя — добавь в текст ответа явный вопрос."
    `);
  });

  it('(н) preHits доезжают в user-блок через composeUserMessageForIteration', () => {
    const out = composeUserMessageForIteration({
      userMessage: 'когда встреча?',
      toolMessages: [],
      history: [],
      summary: null,
      preHits: [
        { query: 'когда встреча', result: [{ id: 'm-1', title: 'Sync' }] },
      ],
    });
    expect(out).toContain('=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===');
    expect(out).toContain('m-1');
    expect(out).toMatchInlineSnapshot(`
      "=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===
      Вот что нашлось в графе компании по этому вопросу. Если этого достаточно — отвечай по этим данным без дополнительных вызовов. Если данных мало — ты можешь вызвать search_knowledge сам.

      [
        {
          "query": "когда встреча",
          "result": [
            {
              "id": "m-1",
              "title": "Sync"
            }
          ]
        }
      ]

      Новый запрос пользователя: когда встреча?"
    `);
  });
});

// ───────────────────────── Legacy guard (Фаза 5) ─────────────────────────
//
// ТЗ 2026-05-27 Фаза 5: явный smoke-тест что при выключенном флаге НИКАКИЕ
// новые dialog-layer / pre-retrieval компоненты не активируются. Дополняет
// тест (д) — там проверяется что `dialog.process` не вызван и есть базовые
// события, а здесь — что метрики dialog-layer / pre-retrieval не дёрнуты
// и dialog-факад не дёргался строго ни разу.

describe('ConciergeService.process() — legacy guard (Фаза 5)', () => {
  it('(о) dialogLayerEnabled=false — ни dialog.process, ни новые метрики не дёрнуты', async () => {
    const dialogProcess = vi.fn();
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      dialog: { process: dialogProcess },
    });

    await collect(
      svc.process({
        userMessage: 'Простой вопрос',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // 1. DialogService.process не вызван ни разу.
    expect(dialogProcess).not.toHaveBeenCalled();
    // 2. Метрика dialog-layer used не дёрнута.
    expect(mocks.metricsIncConciergeDialogLayerUsed).not.toHaveBeenCalled();
    // 3. Метрика cache-hit не дёрнута.
    expect(mocks.metricsIncConciergeCacheHit).not.toHaveBeenCalled();
    // 4. Histogram pre-retrieval не дёрнут.
    expect(mocks.metricsObserveConciergePreRetrievalHits).not.toHaveBeenCalled();
  });
});

// ───────────────────── Ф3 native function-calling (2026-06-11) ─────────────────────
//
// ТЗ plans/tz/2026-06-11-assistant-channels-telegram-max.md Ф3: за kill-switch
// флагом CONCIERGE_NATIVE_TOOLS_ENABLED (default ON в проде, в моках — false,
// см. buildConciergeService) tools уходят провайдеру через LlmCallParams.tools,
// ответный out.toolCalls[0] идёт по СУЩЕСТВУЮЩЕМУ пути исполнения. OFF —
// прежняя regex-эмуляция tryParseToolCall без изменений.

describe('ConciergeService.process() — Ф3 native function-calling', () => {
  it('(п) ON: out.toolCalls → ToolRouter.execute с list_tasks; следующая итерация — финал «Готово»', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Готово',
    });
    // 1-я итерация — native tool_call; 2-я — default-имплементация мока
    // (text='Готово', без toolCalls) → финальный ответ.
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'list_tasks', input: {} }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [] },
      tool: { name: 'list_tasks', method: 'GET' },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Покажи мои задачи',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // Tool исполнен по существующему пути (с SSE tool_call/tool_result).
    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    const execArgs = (toolRouterExec.mock.calls[0]?.[0] ?? {}) as {
      toolName?: string;
    };
    expect(execArgs.toolName).toBe('list_tasks');
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');

    // 2 LLM-итерации; финальное message — 'Готово'.
    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const messageEvent = events.find((e) => e.type === 'message');
    expect(
      messageEvent && messageEvent.type === 'message' && messageEvent.text,
    ).toBe('Готово');
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('(р) ON: ответ без toolCalls → финальный текст, ToolRouter.execute НЕ вызван', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Привет',
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;

    const events = await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).not.toHaveBeenCalled();
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const messageEvent = events.find((e) => e.type === 'message');
    expect(
      messageEvent && messageEvent.type === 'message' && messageEvent.text,
    ).toBe('Привет');
  });

  it('(с) ON: SYSTEM без JSON-инструкции и списка инструментов; tools переданы непустым массивом', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Привет',
    });

    await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ systemPrompt?: string; tools?: unknown[] }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    // SYSTEM стабилен и БЕЗ legacy-инструкции (cache-friendly).
    expect(llmArgs.systemPrompt ?? '').not.toContain('{"tool_call"');
    expect(llmArgs.systemPrompt ?? '').not.toContain(
      '=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===',
    );
    expect(llmArgs.systemPrompt ?? '').toContain('function-calling');
    // Tools уходят провайдеру непустым массивом.
    expect(Array.isArray(llmArgs.tools)).toBe(true);
    expect((llmArgs.tools ?? []).length).toBeGreaterThan(0);
    expect(mocks.serviceMapToLlmTools).toHaveBeenCalled();
    // Legacy toolFragment в native-режиме не собирается вовсе.
    expect(mocks.serviceMapBuildToolUsePromptFragment).not.toHaveBeenCalled();
  });

  it('(т) OFF: regex-путь без изменений — {"tool_call"} в тексте исполняется, tools НЕ передаются', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: false,
      llmResponseText: 'Готово',
    });
    // 1-я итерация — legacy JSON-эмуляция tool_call в тексте; 2-я — финал.
    mocks.llmCall.mockResolvedValueOnce({
      text: '{"tool_call": {"name": "list_tasks", "arguments": {}}}',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [] },
      tool: { name: 'list_tasks', method: 'GET' },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Покажи мои задачи',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // Regex-путь исполнил tool.
    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    const execArgs = (toolRouterExec.mock.calls[0]?.[0] ?? {}) as {
      toolName?: string;
    };
    expect(execArgs.toolName).toBe('list_tasks');

    // SYSTEM — прежний (с JSON-инструкцией), tools в llm.call НЕ передавались.
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ systemPrompt?: string; tools?: unknown[] }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(llmArgs.systemPrompt ?? '').toContain('=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===');
    expect(llmArgs.tools).toBeUndefined();
    expect(mocks.serviceMapToLlmTools).not.toHaveBeenCalled();

    const messageEvent = events.find((e) => e.type === 'message');
    expect(
      messageEvent && messageEvent.type === 'message' && messageEvent.text,
    ).toBe('Готово');
  });
});

// ───────────────────── ServiceMapGeneratorService.toLlmTools() — Ф3 ─────────────────────

describe('ServiceMapGeneratorService.toLlmTools() — Ф3', () => {
  it('(у) маппит ВЕСЬ whitelist (19 tools) в LlmTool с непустыми name/description и input_schema.type=object', () => {
    const gen = new ServiceMapGeneratorService();
    gen.onModuleInit();

    const tools = gen.toLlmTools();
    // Полнота: native function-calling видит те же tools, что и legacy whitelist.
    expect(tools).toHaveLength(gen.getTools().length);
    expect(tools).toHaveLength(19);
    for (const t of tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.properties).toBeDefined();
    }
    // required переносится из ToolSchema.parameters как есть.
    const createMeeting = tools.find((t) => t.name === 'create_meeting');
    expect(createMeeting?.input_schema.required).toEqual(['title', 'type']);
    // У tools без required поле отсутствует (не undefined-мусор в schema).
    const listMeetings = tools.find((t) => t.name === 'list_meetings');
    expect(listMeetings).toBeDefined();
    expect('required' in (listMeetings?.input_schema ?? {})).toBe(false);
  });
});

// ───────────────── Ф6 — канальный whitelist + текст-подтверждение ─────────────────
//
// ТЗ plans/tz/2026-06-11-assistant-channels-telegram-max.md Ф6:
//   (ф) toolWhitelist сужает tools, уходящие провайдеру (native ON);
//   (х) выбор инструмента ВНЕ whitelist → execute НЕ вызван, в следующую
//       итерацию уезжает отказ «недоступен» (модель переформулирует);
//   (ц) confirmHold=true + мутирующий-без-undo → confirm_required, execute
//       НЕ вызван, поток корректно завершён done.

describe('ConciergeService.process() — Ф6 канальный whitelist + confirmHold', () => {
  it('(ф) toolWhitelist=[list_tasks] (native ON) → llm.call получил tools ровно из whitelist', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Привет',
    });

    await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
        toolWhitelist: ['list_tasks'],
      }),
    );

    expect(mocks.serviceMapToLlmTools).toHaveBeenCalledWith(['list_tasks']);
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ tools?: Array<{ name: string }> }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect((llmArgs.tools ?? []).map((t) => t.name)).toEqual(['list_tasks']);
  });

  it('(х) tool вне whitelist → execute НЕ вызван, следующая итерация получает «недоступен»', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Хорошо, не буду',
    });
    // 1-я итерация — модель выбрала инструмент ВНЕ whitelist; 2-я — финал.
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'get_person_pulse', input: { personId: 'p-1' } }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;

    const events = await collect(
      svc.process({
        userMessage: 'что с Иваном?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
        toolWhitelist: ['list_tasks'],
      }),
    );

    // Исполнение отклонено — ToolRouter не дёргался, tool_call/tool_result нет.
    expect(toolRouterExec).not.toHaveBeenCalled();
    const types = events.map((e) => e.type);
    expect(types).not.toContain('tool_call');
    expect(types).not.toContain('tool_result');

    // 2-я итерация LLM получила отказ в блоке tool-результатов.
    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ userMessage?: string }>
    >;
    const secondArgs = llmCalls[1]?.[0] ?? {};
    expect(secondArgs.userMessage ?? '').toContain('недоступен');

    const messageEvent = events.find((e) => e.type === 'message');
    expect(
      messageEvent && messageEvent.type === 'message' && messageEvent.text,
    ).toBe('Хорошо, не буду');
  });

  it('(ц) confirmHold=true + мутирующий-без-undo → confirm_required с превью, execute НЕ вызван, done в конце', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'cancel_meeting', input: { id: 'm-1' } }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;

    const events = await collect(
      svc.process({
        userMessage: 'отмени встречу m-1',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
        confirmHold: true,
      }),
    );

    expect(toolRouterExec).not.toHaveBeenCalled();
    const confirmEvent = events.find((e) => e.type === 'confirm_required');
    expect(confirmEvent).toBeDefined();
    if (confirmEvent && confirmEvent.type === 'confirm_required') {
      expect(confirmEvent.toolName).toBe('cancel_meeting');
      expect(confirmEvent.params).toEqual({ id: 'm-1' });
      // Превью — русское название + ключевые параметры.
      expect(confirmEvent.preview).toContain('отменить встречу');
      expect(confirmEvent.preview).toContain('m-1');
    }
    // Поток корректно завершён done; tool_call/tool_result не эмитились.
    const types = events.map((e) => e.type);
    expect(types).not.toContain('tool_call');
    expect(types).not.toContain('tool_result');
    expect(events[events.length - 1]?.type).toBe('done');
    // Только одна LLM-итерация — после confirm_required генератор завершился.
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
  });

  it('(ш) confirmHold=true + readOnly POST (find_free_slot) → confirm_required НЕ эмитится, исполнен сразу, undo-log не пишется', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Свободный слот — завтра в 15:00',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [
        {
          name: 'find_free_slot',
          input: { participantUserIds: ['u-1', 'u-2'], durationMin: 60 },
        },
      ],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { slot: '2026-06-13T15:00:00Z' },
      tool: { name: 'find_free_slot', method: 'POST' },
    });
    const undoLogRecord = (mocks.undoLog as unknown as {
      record: ReturnType<typeof vi.fn>;
    }).record;

    const events = await collect(
      svc.process({
        userMessage: 'найди слот на час с Васей',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
        confirmHold: true,
      }),
    );

    // readOnly: подтверждение не спрашивается — инструмент исполнен сразу.
    const types = events.map((e) => e.type);
    expect(types).not.toContain('confirm_required');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    // tool_call ушёл без requiresConfirm.
    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    if (toolCallEvent && toolCallEvent.type === 'tool_call') {
      expect(toolCallEvent.requiresConfirm).toBe(false);
    }
    // Семантически read-only — в undo-log не пишется (откатывать нечего).
    expect(undoLogRecord).not.toHaveBeenCalled();
  });

  it('(ч) web-путь без confirmHold: тот же мутирующий tool исполняется сразу (поведение прежнее)', async () => {
    const { svc, mocks } = buildConciergeService({
      dialogLayerEnabled: false,
      nativeToolsEnabled: true,
      llmResponseText: 'Готово',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'cancel_meeting', input: { id: 'm-1' } }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { id: 'm-1' },
      tool: { name: 'cancel_meeting', method: 'POST' },
    });

    const events = await collect(
      svc.process({
        userMessage: 'отмени встречу m-1',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).not.toContain('confirm_required');
  });
});
