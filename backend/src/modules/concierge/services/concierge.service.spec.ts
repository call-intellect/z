/**
 * ТЗ 2026-06-14 (assistant-router-dedup-and-prompt) — unit-тесты
 * `ConciergeService.process()` после превращения помощника в «развилку +
 * руки + уточнитель».
 *
 * Помощник БОЛЬШЕ НЕ владеет пониманием запроса: убраны `dialog.process()`,
 * предпоиск (`preRetrieve`), preHits и метрики dialog-layer. SYSTEM — новый
 * стабильный промпт `CONCIERGE_RESPOND_SYSTEM_PROMPT` (Приложение A). История
 * — 4 пары через крутилку `concierge.history_pairs`. `ask_chat_v2` —
 * терминальный (passthrough текста+цитат на чистом вопросе к памяти).
 *
 * Покрытие:
 *   (а) вопрос к памяти → ask_chat_v2 терминальный (ответ = текст+цитаты
 *       chat-v2 напрямую, без второго синтеза);
 *   (б) смешанный turn (ask_chat_v2 + другой инструмент) → НЕ passthrough,
 *       финализирует модель;
 *   (в) история берётся 4 пары (getDynamic мок → 4) → loadRecentHistory(8);
 *   (г) SYSTEM = новый промпт (фрагменты границ/ingest);
 *   (д) Ф3 native function-calling (теперь прод-дефолт) + legacy regex OFF;
 *   (е) Ф6 канальный whitelist + confirmHold.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import { CONCIERGE_RESPOND_SYSTEM_PROMPT } from '../prompts/concierge-respond.prompt';

import type { ConciergeContextBuilderService } from './concierge-context-builder.service';
import type { ConciergeQuotaService } from './concierge-quota.service';
import type { ConciergeUndoLogService } from './concierge-undo-log.service';
import {
  ConciergeService,
  type ConciergeStreamEvent,
} from './concierge.service';
import { ServiceMapGeneratorService } from './service-map-generator.service';
import type { ToolRouterService } from './tool-router.service';

// ───────────────────────── фикстура сервиса ─────────────────────────

interface BuildOpts {
  llmResponseText?: string;
  conversationSummary?: string | null;
  /** Native function-calling (прод-дефолт ON). false → legacy regex. */
  nativeToolsEnabled?: boolean;
  /** История диалога (мок findMany), хронологический порядок. */
  history?: Array<{ role: string; content: string }>;
  /** Значение крутилки concierge.history_pairs (getDynamic). Default 4. */
  historyPairs?: number;
}

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
  // findMany читает DESC, сервис делает .reverse() → отдаём в DESC-порядке.
  const messageFindMany = vi.fn(async () =>
    (opts.history ?? [])
      .map((m, i) => ({
        id: `h-${i}`,
        conversationId,
        role: m.role,
        content: m.content,
        toolCallsJson: null,
        createdAt: new Date(2026, 0, 1, 0, i),
        updatedAt: new Date(),
      }))
      .slice()
      .reverse(),
  );

  const prisma = {
    conciergeConversation: {
      findFirst: conversationFindFirst,
      create: conversationCreate,
      update: conversationUpdate,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conciergeMessage: {
      create: messageCreate,
      findMany: messageFindMany,
    },
  } as unknown as PrismaService;

  // getDynamic: history_pairs → opts.historyPairs ?? 4; clarify_min_confidence → 80.
  const getDynamic = vi.fn(
    async (key: string, _env: unknown, def: unknown): Promise<unknown> => {
      if (key === 'concierge.history_pairs') return opts.historyPairs ?? 4;
      if (key === 'concierge.clarify_min_confidence') return 80;
      return def;
    },
  );

  const cfg = {
    concierge: {
      enabled: true,
      dailyMessagesLimit: 100,
      monthlyMessagesLimit: 3000,
      sseHeartbeatSeconds: 15,
      // Native function-calling — прод-дефолт ON; в моках задаётся явно.
      nativeToolsEnabled: opts.nativeToolsEnabled ?? false,
    },
    getDynamic,
  } as unknown as TypedConfigService;

  const llm = { call: llmCall } as unknown as LlmRouterService;

  const contextBuilder = {
    build: vi.fn(async () => ''),
  } as unknown as ConciergeContextBuilderService;

  // Мини-реестр: GET (list_tasks/search_tasks), мутирующий-без-undo
  // (cancel_meeting → confirm), readOnly POST (ask_chat_v2 / find_free_slot),
  // self-scoped POST (ingest_note → readOnly), get_person_pulse (для whitelist).
  const MOCK_TOOL_REGISTRY = [
    {
      name: 'list_tasks',
      description: 'Действия-задачи из встреч',
      method: 'GET' as const,
      path: '/api/v1/tasks',
      parameters: { type: 'object' as const, properties: {} },
    },
    {
      name: 'search_tasks',
      description: 'Мои задачи в трекере',
      method: 'GET' as const,
      path: '/api/v1/me/inbox',
      parameters: { type: 'object' as const, properties: {} },
      readOnly: true,
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
    {
      name: 'ask_chat_v2',
      description: 'Вопрос к памяти компании',
      method: 'POST' as const,
      path: '/api/v1/chat-v2/messages',
      parameters: { type: 'object' as const, properties: {} },
      readOnly: true,
    },
    {
      name: 'ingest_note',
      description: 'Занести заметку в память',
      method: 'POST' as const,
      path: '/api/v1/me/notifications/free-note',
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
  const metrics = {
    incConciergeMessage: metricsIncConciergeMessage,
  } as unknown as BusinessMetricsService;

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
      getDynamic,
      metricsIncConciergeMessage,
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

// ───────────────────── SYSTEM = новый промпт (г) ─────────────────────

describe('CONCIERGE_RESPOND_SYSTEM_PROMPT — содержание (Приложение A)', () => {
  it('содержит границы, ingest_note, уточнение и отказ', () => {
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('ТВОИ ГРАНИЦЫ');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('ingest_note');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('записал в память');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain(
      'уточняющий вопрос',
    );
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('вежливый отказ');
    // Никакой легаси-JSON-инструкции и блока ПРЕДВАРИТЕЛЬНЫХ РЕЗУЛЬТАТОВ.
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).not.toContain('{"tool_call"');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).not.toContain(
      'ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ',
    );
  });

  it('process() подаёт новый SYSTEM в llm.call (native ON)', async () => {
    const { svc, mocks } = buildConciergeService({
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
      Array<{ systemPrompt?: string }>
    >;
    const sys = llmCalls[0]?.[0]?.systemPrompt ?? '';
    expect(sys).toContain('ТВОИ ГРАНИЦЫ');
    expect(sys).toContain('ingest_note');
    // SYSTEM стабилен — без легаси-инструкции и без === ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===.
    expect(sys).not.toContain('=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===');
    expect(sys).not.toContain('{"tool_call"');
  });
});

// ───────────────────── история 4 пары (в) ─────────────────────

describe('ConciergeService.process() — история 4 пары через крутилку', () => {
  it('(в) getDynamic(concierge.history_pairs)=4 → loadRecentHistory(take=8)', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      historyPairs: 4,
      llmResponseText: 'Ок',
    });

    await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // getDynamic спрошен про history_pairs.
    const getDynCalls = mocks.getDynamic.mock.calls as unknown as Array<
      [string, unknown, unknown]
    >;
    const keysAsked = getDynCalls.map((c) => c[0]);
    expect(keysAsked).toContain('concierge.history_pairs');
    // loadRecentHistory вызвал findMany с take = pairs*2 = 8.
    const findManyCalls = mocks.messageFindMany.mock.calls as unknown as Array<
      [{ take?: number }]
    >;
    expect(findManyCalls[0]?.[0]?.take).toBe(8);
  });

  it('крутилка=3 → take=6', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      historyPairs: 3,
      llmResponseText: 'Ок',
    });
    await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );
    const findManyCalls = mocks.messageFindMany.mock.calls as unknown as Array<
      [{ take?: number }]
    >;
    expect(findManyCalls[0]?.[0]?.take).toBe(6);
  });
});

// ───────────────────── ask_chat_v2 терминальный (а)/(б) ─────────────────────

describe('ConciergeService.process() — ask_chat_v2 терминальный (passthrough)', () => {
  it('(а) единственный ask_chat_v2 успешен → ответ = текст+цитаты chat-v2 напрямую (без 2-го синтеза)', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      // Если бы был 2-й синтез — модель вернула бы этот текст. Не должен попасть.
      llmResponseText: 'ПЕРЕПИСАННЫЙ-МОДЕЛЬЮ-ОТВЕТ',
    });
    // 1-я итерация — native tool_call ask_chat_v2.
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'ask_chat_v2', input: { question: 'что решили?' } }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        text: 'Решили взять подрядчика А.',
        citations: [{ blockId: 'b-1', label: 'Встреча 12.06' }],
      },
      tool: { name: 'ask_chat_v2', method: 'POST', readOnly: true },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Что мы решили по подрядчику?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Решили взять подрядчика А.',
    );
    // Текст модели (2-й синтез) отброшен.
    expect(
      messageEvent && messageEvent.type === 'message' && messageEvent.text,
    ).not.toContain('ПЕРЕПИСАННЫЙ');
    // Цитаты chat-v2 проброшены в событие message.
    expect(
      messageEvent &&
        messageEvent.type === 'message' &&
        Array.isArray(messageEvent.citations) &&
        messageEvent.citations.length,
    ).toBe(1);
    // Второй LLM-вызов (после tool-результата) ДАЁТ модели шанс продолжить
    // действием. Здесь действия нет → его текст ОТБРАСЫВАЕТСЯ (capture-and-
    // replace): итог = ответ chat-v2, а не «ПЕРЕПИСАННЫЙ-МОДЕЛЬЮ-ОТВЕТ».
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('(б) смешанный turn: ask_chat_v2 + cancel_meeting → НЕ passthrough, финализирует модель', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Готово: узнал и отменил.',
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    // 1-я итерация → ask_chat_v2; 2-я → cancel_meeting; 3-я → финал (default).
    mocks.llmCall
      .mockResolvedValueOnce({
        text: '',
        modelUsed: 'mock',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        durationMs: 0,
        toolCalls: [{ name: 'ask_chat_v2', input: { question: 'кто вёл?' } }],
      })
      .mockResolvedValueOnce({
        text: '',
        modelUsed: 'mock',
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        durationMs: 0,
        toolCalls: [{ name: 'cancel_meeting', input: { id: 'm-1' } }],
      });
    toolRouterExec
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { text: 'Вёл Иван.', citations: [{ blockId: 'b-9' }] },
        tool: { name: 'ask_chat_v2', method: 'POST', readOnly: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { id: 'm-1' },
        tool: { name: 'cancel_meeting', method: 'POST' },
      });

    const events = await collect(
      svc.process({
        userMessage: 'Узнай, кто вёл встречу, и отмени её',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    // Финальный ответ — от модели (3-й вызов), НЕ захваченный chat-v2.
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Готово: узнал и отменил.',
    );
    // Цитаты chat-v2 НЕ проброшены (не passthrough).
    expect(
      messageEvent &&
        messageEvent.type === 'message' &&
        messageEvent.citations,
    ).toBeUndefined();
    // Оба инструмента исполнены.
    expect(toolRouterExec).toHaveBeenCalledTimes(2);
    // 3 LLM-вызова (2 выбора + финал).
    expect(mocks.llmCall).toHaveBeenCalledTimes(3);
  });

  it('ask_chat_v2 FAIL → НЕ passthrough (нечего отдавать), модель финализирует', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Не удалось получить ответ из памяти.',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'ask_chat_v2', input: { question: 'что?' } }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: false,
      status: 500,
      result: null,
      tool: { name: 'ask_chat_v2', method: 'POST', readOnly: true },
      errorMessage: 'HTTP 500',
    });

    const events = await collect(
      svc.process({
        userMessage: 'Что решили?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Не удалось получить ответ из памяти.',
    );
    expect(
      messageEvent &&
        messageEvent.type === 'message' &&
        messageEvent.citations,
    ).toBeUndefined();
  });
});

// ───────────────────── Ф3 native function-calling (прод-дефолт) ─────────────────────

describe('ConciergeService.process() — Ф3 native function-calling', () => {
  it('(д.1) ON: out.toolCalls → ToolRouter.execute с list_tasks; финал «Готово»', async () => {
    const { svc, mocks } = buildConciergeService({
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
        userMessage: 'Покажи задачи из встреч',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    const execArgs = (toolRouterExec.mock.calls[0]?.[0] ?? {}) as {
      toolName?: string;
    };
    expect(execArgs.toolName).toBe('list_tasks');
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const messageEvent = events.find((e) => e.type === 'message');
    expect(
      messageEvent && messageEvent.type === 'message' && messageEvent.text,
    ).toBe('Готово');
  });

  it('(д.2) ON: ответ без toolCalls → финальный текст, execute НЕ вызван; tools переданы непустым массивом', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Привет',
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;

    await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).not.toHaveBeenCalled();
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ tools?: unknown[] }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(Array.isArray(llmArgs.tools)).toBe(true);
    expect((llmArgs.tools ?? []).length).toBeGreaterThan(0);
    expect(mocks.serviceMapToLlmTools).toHaveBeenCalled();
  });

  it('(д.3) OFF: legacy regex-путь — {"tool_call"} в тексте исполняется, tools НЕ передаются', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: false,
      llmResponseText: 'Готово',
    });
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

    await collect(
      svc.process({
        userMessage: 'Покажи задачи',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ tools?: unknown[] }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(llmArgs.tools).toBeUndefined();
    expect(mocks.serviceMapToLlmTools).not.toHaveBeenCalled();
  });
});

// ───────────────── Ф6 — канальный whitelist + confirmHold ─────────────────

describe('ConciergeService.process() — Ф6 канальный whitelist + confirmHold', () => {
  it('(е.1) toolWhitelist=[list_tasks] (native ON) → llm.call получил tools ровно из whitelist', async () => {
    const { svc, mocks } = buildConciergeService({
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

  it('(е.2) tool вне whitelist → execute НЕ вызван, следующая итерация получает «недоступен»', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Хорошо, не буду',
    });
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

    expect(toolRouterExec).not.toHaveBeenCalled();
    const types = events.map((e) => e.type);
    expect(types).not.toContain('tool_call');
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ userMessage?: string }>
    >;
    const secondArgs = llmCalls[1]?.[0] ?? {};
    expect(secondArgs.userMessage ?? '').toContain('недоступен');
  });

  it('(е.3) confirmHold=true + мутирующий-без-undo (cancel_meeting) → confirm_required, execute НЕ вызван, done', async () => {
    const { svc, mocks } = buildConciergeService({
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
      expect(confirmEvent.preview).toContain('отменить встречу');
    }
    expect(events[events.length - 1]?.type).toBe('done');
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
  });

  it('(е.4) confirmHold=true + ingest_note (readOnly) → исполнен сразу, confirm НЕ нужен', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Записал в память.',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: '',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      toolCalls: [{ name: 'ingest_note', input: { text: 'Идея про поддержку' } }],
    });
    const toolRouterExec = (mocks.toolRouter as unknown as {
      execute: ReturnType<typeof vi.fn>;
    }).execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 201,
      result: { rawEventId: 're-1' },
      tool: { name: 'ingest_note', method: 'POST', readOnly: true },
    });
    const undoLogRecord = (mocks.undoLog as unknown as {
      record: ReturnType<typeof vi.fn>;
    }).record;

    const events = await collect(
      svc.process({
        userMessage: 'Идея: добавить раздел про поддержку',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
        confirmHold: true,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).not.toContain('confirm_required');
    expect(types).toContain('tool_result');
    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    // readOnly → undo-log не пишется.
    expect(undoLogRecord).not.toHaveBeenCalled();
  });
});

// ───────────────── ServiceMapGeneratorService.toLlmTools() ─────────────────

describe('ServiceMapGeneratorService.toLlmTools() — полнота', () => {
  it('маппит весь whitelist в LlmTool с непустыми name/description, input_schema.type=object', () => {
    const gen = new ServiceMapGeneratorService();
    gen.onModuleInit();

    const tools = gen.toLlmTools();
    expect(tools).toHaveLength(gen.getTools().length);
    for (const t of tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.properties).toBeDefined();
    }
    const createMeeting = tools.find((t) => t.name === 'create_meeting');
    expect(createMeeting?.input_schema.required).toEqual(['title', 'type']);
    const listMeetings = tools.find((t) => t.name === 'list_meetings');
    expect('required' in (listMeetings?.input_schema ?? {})).toBe(false);
  });
});
