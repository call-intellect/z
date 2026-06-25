import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ChatV2OrchestrationService } from '../../chat-v2/chat-v2.service';
import { CONCIERGE_RESPOND_SYSTEM_PROMPT } from '../prompts/concierge-respond.prompt';

import type { ConciergeContextBuilderService } from './concierge-context-builder.service';
import type { ConciergeQuotaService } from './concierge-quota.service';
import type { ConciergeUndoLogService } from './concierge-undo-log.service';
import { ConciergeService, type ConciergeStreamEvent } from './concierge.service';
import { ServiceMapGeneratorService } from './service-map-generator.service';
import type { ToolRouterService } from './tool-router.service';

interface BuildOpts {
  llmResponseText?: string;
  conversationSummary?: string | null;
  nativeToolsEnabled?: boolean;
  history?: Array<{ role: string; content: string; toolCallsJson?: unknown }>;
  historyPairs?: number;
  ephemeralAnswer?: {
    text: string;
    citations?: unknown[];
    needsClarification?: boolean;
  };
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
  const messageFindMany = vi.fn(async () =>
    (opts.history ?? [])
      .map((m, i) => ({
        id: `h-${i}`,
        conversationId,
        role: m.role,
        content: m.content,
        toolCallsJson: m.toolCallsJson ?? null,
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

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown): Promise<unknown> => {
    if (key === 'concierge.history_pairs') return opts.historyPairs ?? 4;
    if (key === 'concierge.clarify_min_confidence') return 80;
    return def;
  });

  const cfg = {
    concierge: {
      enabled: true,
      dailyMessagesLimit: 100,
      monthlyMessagesLimit: 3000,
      sseHeartbeatSeconds: 15,
      nativeToolsEnabled: opts.nativeToolsEnabled ?? false,
      prmShadowEnabled: false,
    },
    getDynamic,
  } as unknown as TypedConfigService;

  const llm = { call: llmCall } as unknown as LlmRouterService;

  const askEphemeral = vi.fn(async () => ({
    text: opts.ephemeralAnswer?.text ?? 'Ответ из памяти.',
    citations: opts.ephemeralAnswer?.citations ?? [],
    needsClarification: opts.ephemeralAnswer?.needsClarification ?? false,
    dataClass: 'internal' as const,
    usedBlockIds: [],
    uncertaintyNote: null,
    mode: 'factual' as const,
  }));
  const chatV2 = { askEphemeral } as unknown as ChatV2OrchestrationService;

  const contextBuilder = {
    build: vi.fn(async () => ''),
  } as unknown as ConciergeContextBuilderService;

  const MOCK_TOOL_REGISTRY = [
    {
      name: 'list_tasks',
      description: 'Действия-задачи из встреч',
      method: 'GET' as const,
      path: '/api/v1/tasks',
      parameters: { type: 'object' as const, properties: {} },
    },
    {
      name: 'list_meetings',
      description: 'Список встреч',
      method: 'GET' as const,
      path: '/api/v1/meetings',
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
      name: 'create_event',
      description: 'Создать событие в календаре',
      method: 'POST' as const,
      path: '/api/v1/events',
      undoableVia: 'delete_event',
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
    MOCK_TOOL_REGISTRY.filter((t) => !names || names.includes(t.name)).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object' as const, properties: {} },
    })),
  );
  const serviceMapBuildToolUsePromptFragment = vi.fn(() => '[]');
  const serviceMap = {
    buildToolUsePromptFragment: serviceMapBuildToolUsePromptFragment,
    toLlmTools: serviceMapToLlmTools,
    findTool: vi.fn((name: string) => MOCK_TOOL_REGISTRY.find((t) => t.name === name) ?? null),
  } as unknown as ServiceMapGeneratorService;

  const toolRouter = {
    execute: vi.fn(),
  } as unknown as ToolRouterService;

  const undoLog = {
    record: vi.fn(async () => ({ id: 'undo-1' })),
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
    chatV2,
  );

  return {
    svc,
    mocks: {
      llmCall,
      askEphemeral,
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

function nativeToolCall(name: string, input: unknown): MockLlmCallResult {
  return {
    text: '',
    modelUsed: 'mock',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durationMs: 0,
    toolCalls: [{ name, input }],
  };
}

describe('CONCIERGE_RESPOND_SYSTEM_PROMPT — содержание', () => {
  it('содержит границы, ingest_note, уточнение и отказ; без многошагового фрейминга', () => {
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('ТВОИ ГРАНИЦЫ');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('ingest_note');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('записал в память');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('уточняющий вопрос');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).toContain('вежливый отказ');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).not.toContain('{"tool_call"');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).not.toContain('вызывай\nпо очереди');
    expect(CONCIERGE_RESPOND_SYSTEM_PROMPT).not.toContain('сначала память, потом действие');
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
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<Array<{ systemPrompt?: string }>>;
    const sys = llmCalls[0]?.[0]?.systemPrompt ?? '';
    expect(sys).toContain('ТВОИ ГРАНИЦЫ');
    expect(sys).toContain('ingest_note');
    expect(sys).not.toContain('=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===');
    expect(sys).not.toContain('{"tool_call"');
  });
});

describe('ConciergeService.process() — история через крутилку', () => {
  it('getDynamic(concierge.history_pairs)=4 → loadRecentHistory(take=8)', async () => {
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

    const getDynCalls = mocks.getDynamic.mock.calls as unknown as Array<[string, unknown, unknown]>;
    const keysAsked = getDynCalls.map((c) => c[0]);
    expect(keysAsked).toContain('concierge.history_pairs');
    const findManyCalls = mocks.messageFindMany.mock.calls as unknown as Array<[{ take?: number }]>;
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
    const findManyCalls = mocks.messageFindMany.mock.calls as unknown as Array<[{ take?: number }]>;
    expect(findManyCalls[0]?.[0]?.take).toBe(6);
  });
});

describe('ConciergeService.process() — единый проход: ask_chat_v2 in-process (прод-регресс)', () => {
  it('(1) dispatch выбирает ask_chat_v2 → askEphemeral → ровно ОДНО message verbatim + done; LLM 1 раз; toolRouter НЕ вызван; без сырого JSON', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      ephemeralAnswer: {
        text: 'Решили взять подрядчика А.',
        citations: [{ blockId: 'b-1', label: 'Встреча 12.06' }],
      },
    });
    mocks.llmCall.mockResolvedValueOnce(
      nativeToolCall('ask_chat_v2', { question: 'что решили?' }),
    );

    const events = await collect(
      svc.process({
        userMessage: 'Что мы решили по подрядчику?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    const messageEvents = events.filter((e) => e.type === 'message');
    expect(messageEvents).toHaveLength(1);
    const messageEvent = messageEvents[0];
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Решили взять подрядчика А.',
    );
    const allText = JSON.stringify(events);
    expect(allText).not.toContain('"tool_call"');
    expect(
      messageEvent &&
        messageEvent.type === 'message' &&
        Array.isArray(messageEvent.citations) &&
        messageEvent.citations.length,
    ).toBe(1);
    expect(events[events.length - 1]?.type).toBe('done');

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    expect(mocks.askEphemeral).toHaveBeenCalledTimes(1);
    expect(mocks.askEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'что решили?',
        intent: 'factual',
        tenantId: 't-1',
        userId: 'u-1',
      }),
    );
    const execMock = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
    expect(execMock).not.toHaveBeenCalled();
  });

  it('ask_chat_v2 без параметра question → fallback на userMessage', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      ephemeralAnswer: { text: 'Ответ.' },
    });
    mocks.llmCall.mockResolvedValueOnce(nativeToolCall('ask_chat_v2', {}));

    await collect(
      svc.process({
        userMessage: 'Кто отвечает за логистику?',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(mocks.askEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Кто отвечает за логистику?' }),
    );
  });
});

describe('ConciergeService.process() — read-tool рендер', () => {
  it('(2) list_meetings → execute 1 раз + ровно 1 render-LLM → message = render text (LLM ровно 2)', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'У вас 3 встречи на этой неделе.',
    });
    mocks.llmCall.mockResolvedValueOnce(nativeToolCall('list_meetings', {}));
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [{ id: 'm-1' }, { id: 'm-2' }, { id: 'm-3' }] },
      tool: { name: 'list_meetings', method: 'GET' },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Покажи встречи',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    expect(toolRouterExec).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'list_meetings' }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const renderCall = (
      mocks.llmCall.mock.calls as unknown as Array<Array<{ tools?: unknown; systemPrompt?: string }>>
    )[1];
    expect(renderCall?.[0]?.tools).toBeUndefined();
    expect(renderCall?.[0]?.systemPrompt ?? '').toContain('НЕ выводи JSON');
    expect(renderCall?.[0]?.systemPrompt ?? '').not.toContain('КАК ТЫ РЕШАЕШЬ');
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'У вас 3 встречи на этой неделе.',
    );
    expect(mocks.askEphemeral).not.toHaveBeenCalled();
  });

  it('render-путь использует выделенный render-промпт, а НЕ промпт-диспетчер (защита от утечки tool_call JSON, native OFF)', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: false,
      llmResponseText: 'У вас одна встреча сегодня.',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: '{"tool_call": {"name": "list_meetings", "arguments": {}}}',
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    });
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [{ id: 'm-1' }] },
      tool: { name: 'list_meetings', method: 'GET' },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Покажи встречи',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const calls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ tools?: unknown; systemPrompt?: string }>
    >;
    const dispatchSystem = calls[0]?.[0]?.systemPrompt ?? '';
    const renderSystem = calls[1]?.[0]?.systemPrompt ?? '';
    expect(dispatchSystem).toContain('=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===');
    expect(renderSystem).toContain('НЕ выводи JSON');
    expect(renderSystem).not.toContain('=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===');
    expect(renderSystem).not.toContain('{"tool_call":');
    expect(calls[1]?.[0]?.tools).toBeUndefined();
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'У вас одна встреча сегодня.',
    );
  });
});

describe('ConciergeService.process() — мутации и confirm', () => {
  it('(3) confirmHold=true + cancel_meeting (мутация без undo) → confirm_required + done, execute НЕ вызван, без render', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
    });
    mocks.llmCall.mockResolvedValueOnce(nativeToolCall('cancel_meeting', { id: 'm-1' }));
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;

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
    expect(events.some((e) => e.type === 'message')).toBe(false);
    expect(events[events.length - 1]?.type).toBe('done');
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
  });

  it('(4) кабинет (confirmHold falsy) + cancel_meeting → tool_call(requiresConfirm:true) + execute + undo записан + tool_result + ОДИН render message', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Встреча отменена.',
    });
    mocks.llmCall.mockResolvedValueOnce(nativeToolCall('cancel_meeting', { id: 'm-1' }));
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 200,
      result: { id: 'm-1' },
      tool: { name: 'cancel_meeting', method: 'POST' },
    });
    const undoLogRecord = (mocks.undoLog as unknown as { record: ReturnType<typeof vi.fn> }).record;

    const events = await collect(
      svc.process({
        userMessage: 'отмени встречу m-1',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    expect(toolCallEvent && toolCallEvent.type === 'tool_call' && toolCallEvent.requiresConfirm).toBe(
      true,
    );
    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    expect(undoLogRecord).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
    expect(mocks.llmCall).toHaveBeenCalledTimes(2);
    const messageEvents = events.filter((e) => e.type === 'message');
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0] && messageEvents[0].type === 'message' && messageEvents[0].text).toBe(
      'Встреча отменена.',
    );
  });

  it('undoableVia мутация (create_event) в кабинете → НЕ requiresConfirm, execute + undo + render', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Событие создано.',
    });
    mocks.llmCall.mockResolvedValueOnce(
      nativeToolCall('create_event', { title: 'Созвон', startAt: '2026-07-01' }),
    );
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 201,
      result: { id: 'e-1' },
      tool: { name: 'create_event', method: 'POST', undoableVia: 'delete_event' },
    });
    const undoLogRecord = (mocks.undoLog as unknown as { record: ReturnType<typeof vi.fn> }).record;

    const events = await collect(
      svc.process({
        userMessage: 'создай событие',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
        confirmHold: true,
      }),
    );

    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    expect(toolCallEvent && toolCallEvent.type === 'tool_call' && toolCallEvent.requiresConfirm).toBe(
      false,
    );
    expect(events.some((e) => e.type === 'confirm_required')).toBe(false);
    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    expect(undoLogRecord).toHaveBeenCalledTimes(1);
  });
});

describe('ConciergeService.process() — ingest_note + final + whitelist', () => {
  it('(5) ingest_note → исполнен + детерминированный «Записал в память.», без render-LLM', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
    });
    mocks.llmCall.mockResolvedValueOnce(
      nativeToolCall('ingest_note', { text: 'Идея про поддержку' }),
    );
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
    toolRouterExec.mockResolvedValue({
      ok: true,
      status: 201,
      result: { rawEventId: 're-1' },
      tool: { name: 'ingest_note', method: 'POST', readOnly: true },
    });

    const events = await collect(
      svc.process({
        userMessage: 'Идея: добавить раздел про поддержку',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(toolRouterExec).toHaveBeenCalledTimes(1);
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_result');
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Записал в память.',
    );
  });

  it('(6) kind:final (без tool) → текст эмитится как message, LLM 1 раз', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
      llmResponseText: 'Привет! Чем помочь по работе?',
    });

    const events = await collect(
      svc.process({
        userMessage: 'Привет',
        userId: 'u-1',
        tenantId: 't-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
    expect(toolRouterExec).not.toHaveBeenCalled();
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'Привет! Чем помочь по работе?',
    );
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('tool вне whitelist → короткое сообщение о недоступности, execute НЕ вызван, без повторов', async () => {
    const { svc, mocks } = buildConciergeService({
      nativeToolsEnabled: true,
    });
    mocks.llmCall.mockResolvedValueOnce(nativeToolCall('get_person_pulse', { personId: 'p-1' }));
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;

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
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const types = events.map((e) => e.type);
    expect(types).not.toContain('tool_call');
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toContain(
      'недоступно в этом канале',
    );
  });

  it('whitelist → llm.call получил tools ровно из whitelist', async () => {
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
});

describe('ConciergeService.process() — legacy regex-ветка (native OFF)', () => {
  it('OFF: {"tool_call"} в тексте исполняется, tools НЕ передаются', async () => {
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
    const toolRouterExec = (mocks.toolRouter as unknown as { execute: ReturnType<typeof vi.fn> })
      .execute;
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
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<Array<{ tools?: unknown[] }>>;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(llmArgs.tools).toBeUndefined();
    expect(mocks.serviceMapToLlmTools).not.toHaveBeenCalled();
  });
});

describe('ConciergeService.process() — clarify resume (concierge владеет тредом)', () => {
  it('(7) askEphemeral.needsClarification → сообщение помечено clarifyPending; 2-й ход пропускает dispatch и роутит ответ в askEphemeral', async () => {
    const turn1 = buildConciergeService({
      nativeToolsEnabled: true,
      ephemeralAnswer: {
        text: 'Уточните: какой именно подрядчик?',
        needsClarification: true,
      },
    });
    turn1.mocks.llmCall.mockResolvedValueOnce(
      nativeToolCall('ask_chat_v2', { question: 'что решили?' }),
    );

    await collect(
      turn1.svc.process({
        userMessage: 'Что решили по подрядчику?',
        userId: 'u-1',
        tenantId: 't-1',
        conversationId: 'conv-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    const assistantCreate = (
      turn1.mocks.messageCreate.mock.calls as unknown as Array<
        [{ data: { role: string; toolCallsJson?: unknown } }]
      >
    ).find((c) => c[0].data.role === 'assistant');
    expect(assistantCreate?.[0]?.data.toolCallsJson).toEqual(
      expect.objectContaining({ clarifyPending: true }),
    );

    const turn2 = buildConciergeService({
      nativeToolsEnabled: true,
      history: [
        { role: 'user', content: 'Что решили по подрядчику?' },
        {
          role: 'assistant',
          content: 'Уточните: какой именно подрядчик?',
          toolCallsJson: { askChatV2Passthrough: true, clarifyPending: true },
        },
      ],
      ephemeralAnswer: { text: 'По подрядчику логистики решили взять А.' },
    });

    const events = await collect(
      turn2.svc.process({
        userMessage: 'по логистике',
        userId: 'u-1',
        tenantId: 't-1',
        conversationId: 'conv-1',
        baseUrl: 'http://localhost:3000',
      }),
    );

    expect(turn2.mocks.llmCall).not.toHaveBeenCalled();
    expect(turn2.mocks.askEphemeral).toHaveBeenCalledTimes(1);
    expect(turn2.mocks.askEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'по логистике', intent: 'factual' }),
    );
    const messageEvent = events.find((e) => e.type === 'message');
    expect(messageEvent && messageEvent.type === 'message' && messageEvent.text).toBe(
      'По подрядчику логистики решили взять А.',
    );
  });
});

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

describe('ConciergeService.buildConfirmPreview — человекочитаемый preview', () => {
  it('create_task{title,description,dueDate} → без сырых англ. ключей и имени инструмента', () => {
    const { svc } = buildConciergeService({});
    const preview = (
      svc as unknown as {
        buildConfirmPreview(toolName: string, params: Record<string, unknown>): string;
      }
    ).buildConfirmPreview('create_task', {
      title: 'Тестирование бота',
      description: 'детали задачи',
      dueDate: '2026-06-19',
    });
    expect(preview).not.toContain('title:');
    expect(preview).not.toContain('description:');
    expect(preview).not.toContain('dueDate:');
    expect(preview).not.toContain('create_task');
    expect(preview).toContain('поставить задачу себе');
    expect(preview).toContain('19 июня');
  });

  it('assign_task{assigneeName,title} → «кому» + имя, без сырого assigneeName/assign_task', () => {
    const { svc } = buildConciergeService({});
    const preview = (
      svc as unknown as {
        buildConfirmPreview(toolName: string, params: Record<string, unknown>): string;
      }
    ).buildConfirmPreview('assign_task', {
      title: 'Протестировать бота',
      assigneeName: 'Айназ',
    });
    expect(preview).toContain('кому');
    expect(preview).toContain('Айназ');
    expect(preview).not.toContain('assigneeName');
    expect(preview).not.toContain('assign_task');
    expect(preview).toContain('поставить задачу сотруднику');
  });
});
