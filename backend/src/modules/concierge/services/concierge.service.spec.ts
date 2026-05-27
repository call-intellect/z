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

  const metrics = {
    incConciergeMessage: vi.fn(),
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
