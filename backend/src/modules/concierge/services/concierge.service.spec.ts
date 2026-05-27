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
 *   (к) полный flow Фаза 3 — preHits попадают в systemPrompt + событие thinking.
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
import type { ServiceMapGeneratorService } from './service-map-generator.service';
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
}

function buildConciergeService(opts: BuildOpts) {
  const conversationId = 'conv-1';
  const userMessageId = 'msg-user-1';
  const assistantMessageId = 'msg-asst-1';

  const llmCall = vi.fn(async () => ({
    text: opts.llmResponseText ?? 'Финальный ответ',
    modelUsed: 'mock',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durationMs: 0,
  }));

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
    },
  } as unknown as TypedConfigService;

  const llm = { call: llmCall } as unknown as LlmRouterService;

  const contextBuilder = {
    build: vi.fn(async () => ''),
  } as unknown as ConciergeContextBuilderService;

  const serviceMap = {
    buildToolUsePromptFragment: vi.fn(() => '[]'),
    findTool: vi.fn(() => null),
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
      toolRouter,
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

  it('(к) полный flow Фаза 3: preHits попадают в systemPrompt и в событие thinking', async () => {
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

    // 3. systemPrompt содержит блок ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ и item-1.
    const llmCalls = mocks.llmCall.mock.calls as unknown as Array<
      Array<{ systemPrompt?: string }>
    >;
    const llmArgs = llmCalls[0]?.[0] ?? {};
    expect(llmArgs.systemPrompt ?? '').toContain('ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ');
    expect(llmArgs.systemPrompt ?? '').toContain('item-1');

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

// ───────────────────────── buildSystemPrompt (Фаза 5) ─────────────────────────
//
// ТЗ 2026-05-27 Фаза 5: snapshot-тесты pure-функции `buildSystemPrompt`.
// Фиксируем формат системного промпта Concierge для двух кейсов:
//   (м) без preHits — обычный промпт с контекстом и tool-fragment;
//   (н) с preHits — добавляется блок ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА.
// Обновлять snapshot'ы только при осознанном изменении формата.

describe('buildSystemPrompt (Фаза 5)', () => {
  it('(м) без preHits — обычный промпт с контекстом и tool-fragment', () => {
    const out = buildSystemPrompt({
      contextBlock: 'User: Иван, Org: Acme',
      toolFragment: '[{"name":"list_meetings"}]',
      preHits: [],
    });
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
      - Для создания/изменения ресурсов — предпочитай tools с undoableVia (их можно отменить).
      - Если необходимо подтверждение пользователя — добавь в текст ответа явный вопрос."
    `);
  });

  it('(н) с preHits — добавляется блок ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА с m-1', () => {
    const out = buildSystemPrompt({
      contextBlock: 'User: Иван',
      toolFragment: '[{"name":"list_meetings"}]',
      preHits: [
        { query: 'когда встреча', result: [{ id: 'm-1', title: 'Sync' }] },
      ],
    });
    expect(out).toContain('=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===');
    expect(out).toContain('m-1');
    expect(out).toMatchInlineSnapshot(`
      "Ты — Concierge, AI-помощник в кабинете компании Z (Кора).
      Отвечай по-русски, кратко и по делу.

      === КОНТЕКСТ ===
      User: Иван

      === ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===
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

      === ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===
      Если запрос требует действия — верни ОДНУ строку строго в формате JSON:
      {"tool_call": {"name": "<имя>", "arguments": { ... }}}
      Если действие не требуется — верни просто текст ответа без JSON.
      Имя инструмента ДОЛЖНО быть из списка ниже:
      [{"name":"list_meetings"}]

      Принципы:
      - Никогда не выдумывай данные. Если не знаешь — используй search_knowledge или ask_chat_v2.
      - Для создания/изменения ресурсов — предпочитай tools с undoableVia (их можно отменить).
      - Если необходимо подтверждение пользователя — добавь в текст ответа явный вопрос."
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
