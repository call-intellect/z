import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type {
  LlmCallParams,
  LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import type { FeedbackDigestQueue } from '../workers/feedback-digest.queue';

import { FeedbackDigestService } from './feedback-digest.service';

function makeMetrics(): {
  metrics: BusinessMetricsService;
  calls: {
    run: ReturnType<typeof vi.fn>;
    processed: ReturnType<typeof vi.fn>;
    newTopics: ReturnType<typeof vi.fn>;
    failedRuns: ReturnType<typeof vi.fn>;
  };
} {
  const run = vi.fn();
  const processed = vi.fn();
  const newTopics = vi.fn();
  const failedRuns = vi.fn();
  const metrics = {
    incFeedbackDigestRun: run,
    incFeedbackDigestMessagesProcessed: processed,
    incFeedbackDigestNewTopics: newTopics,
    incFeedbackDigestFailedRuns: failedRuns,
  } as unknown as BusinessMetricsService;
  return { metrics, calls: { run, processed, newTopics, failedRuns } };
}

interface PrismaCalls {
  findMessages: ReturnType<typeof vi.fn>;
  findTopics: ReturnType<typeof vi.fn>;
  txTopicCreate: ReturnType<typeof vi.fn>;
  txItemCreate: ReturnType<typeof vi.fn>;
  txMessageUpdateMany: ReturnType<typeof vi.fn>;
  msgUpdateMany: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

interface PrismaStub {
  prisma: PrismaService;
  calls: PrismaCalls;
}

function makePrisma(
  opts: {
    messages?: Array<{
      id: string;
      userId: string;
      createdAt: Date;
      text: string;
    }>;
    topics?: Array<{ id: string; title: string; description: string }>;
    txThrows?: Error;
  } = {},
): PrismaStub {
  const findMessages = vi.fn(async () => opts.messages ?? []);
  const findTopics = vi.fn(async () => opts.topics ?? []);
  let nextTopicCounter = 1;
  const txTopicCreate = vi.fn(async (q: { data: { title: string; description: string } }) => ({
    id: `created_topic_${nextTopicCounter++}`,
    title: q.data.title,
    description: q.data.description,
  }));
  const txItemCreate = vi.fn(async () => ({ id: 'created_item' }));
  const txMessageUpdateMany = vi.fn(async () => ({ count: 0 }));
  const msgUpdateMany = vi.fn(async () => ({ count: 0 }));
  const msgCount = vi.fn(async () => 0);

  const transaction = vi.fn(
    async <T>(
      cb: (tx: {
        feedbackTopic: { create: typeof txTopicCreate };
        feedbackItem: { create: typeof txItemCreate };
        feedbackMessage: { updateMany: typeof txMessageUpdateMany };
      }) => Promise<T>,
    ): Promise<T> => {
      if (opts.txThrows) throw opts.txThrows;
      return cb({
        feedbackTopic: { create: txTopicCreate },
        feedbackItem: { create: txItemCreate },
        feedbackMessage: { updateMany: txMessageUpdateMany },
      });
    },
  );

  const prisma = {
    feedbackMessage: {
      findMany: findMessages,
      updateMany: msgUpdateMany,
      count: msgCount,
    },
    feedbackTopic: {
      findMany: findTopics,
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  return {
    prisma,
    calls: {
      findMessages,
      findTopics,
      txTopicCreate,
      txItemCreate,
      txMessageUpdateMany,
      msgUpdateMany,
      transaction,
    },
  };
}

interface RedisCalls {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

interface RedisStub {
  redis: RedisService;
  calls: RedisCalls;
}

function makeRedis(opts: { lockHeld?: boolean } = {}): RedisStub {
  let storedToken: string | null = null;
  const set = vi.fn(async (_k: string, value: string) => {
    if (opts.lockHeld) return null;
    storedToken = value;
    return 'OK';
  });
  const get = vi.fn(async () => storedToken);
  const del = vi.fn(async () => {
    storedToken = null;
    return 1;
  });
  const redis = {
    client: { set, get, del },
  } as unknown as RedisService;
  return { redis, calls: { set, get, del } };
}

interface LlmStub {
  llm: LlmRouterService;
  call: ReturnType<typeof vi.fn>;
}

function makeLlm(responses: Array<string | Error>): LlmStub {
  let i = 0;
  const call = vi.fn(async (_params: LlmCallParams): Promise<LlmCallResult> => {
    const next = responses[i++] ?? new Error('No more mock responses');
    if (next instanceof Error) throw next;
    return {
      text: next,
      modelUsed: `mock:m${i}`,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      durationMs: 10,
      tier: 'primary',
    };
  });
  const llm = { call } as unknown as LlmRouterService;
  return { llm, call };
}

function makeQueue(): {
  queue: FeedbackDigestQueue;
  enqueueManualRun: ReturnType<typeof vi.fn>;
} {
  const enqueueManualRun = vi.fn(async () => ({
    jobId: 'feedback-digest-manual-mock',
  }));
  const queue = {
    enqueueManualRun,
  } as unknown as FeedbackDigestQueue;
  return { queue, enqueueManualRun };
}

const NOW = new Date(Date.UTC(2026, 4, 25, 12, 0, 0));

const SAMPLE_MESSAGES = [
  {
    id: 'msg_1',
    userId: 'u_1',
    createdAt: new Date(Date.UTC(2026, 4, 25, 10, 0, 0)),
    text: 'дайте тёмную тему',
  },
  {
    id: 'msg_2',
    userId: 'u_2',
    createdAt: new Date(Date.UTC(2026, 4, 25, 10, 30, 0)),
    text: 'кнопка экспорта виснет',
  },
  {
    id: 'msg_3',
    userId: 'u_3',
    createdAt: new Date(Date.UTC(2026, 4, 25, 11, 0, 0)),
    text: 'хочу темную тему интерфейса',
  },
];

const SAMPLE_TOPICS = [
  {
    id: 'topic_dark',
    title: 'Тёмная тема',
    description: 'Запросы на тёмную тему интерфейса.',
  },
  {
    id: 'topic_export',
    title: 'Проблемы с экспортом',
    description: 'Жалобы на работу кнопки экспорта.',
  },
];

const GOOD_AGENT_OUTPUT = JSON.stringify({
  newTopics: [
    {
      tempId: 'new_1',
      title: 'Новая идея',
      description: 'Что-то совсем новое.',
    },
  ],
  assignments: [
    {
      messageId: 'msg_1',
      items: [{ text: 'хочу тёмную тему', topicRef: 'topic_dark' }],
    },
    {
      messageId: 'msg_2',
      items: [{ text: 'экспорт виснет', topicRef: 'topic_export' }],
    },
    {
      messageId: 'msg_3',
      items: [{ text: 'хочу что-то новое', topicRef: 'new_1' }],
    },
  ],
});

describe('FeedbackDigestService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('пустой батч (нет unprocessed) → { skipped: true }, агент не дёргается', async () => {
    const p = makePrisma({ messages: [] });
    const r = makeRedis();
    const l = makeLlm([]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    const result = await svc.runDigest();

    expect(result).toMatchObject({
      skipped: true,
      processed: 0,
      newTopics: 0,
    });
    expect(l.call).not.toHaveBeenCalled();
    expect(p.calls.transaction).not.toHaveBeenCalled();
    expect(r.calls.set).toHaveBeenCalledTimes(1);
    expect(r.calls.del).toHaveBeenCalledTimes(1);
  });

  it('корректный батч 3 messages + 2 existing topics → 2 в existing + 1 новый topic → создаёт items в транзакции', async () => {
    const p = makePrisma({
      messages: SAMPLE_MESSAGES,
      topics: SAMPLE_TOPICS,
    });
    const r = makeRedis();
    const l = makeLlm([GOOD_AGENT_OUTPUT]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    const result = await svc.runDigest();

    expect(result).toEqual({
      skipped: false,
      processed: 3,
      newTopics: 1,
    });
    expect(l.call).toHaveBeenCalledTimes(1);
    expect(p.calls.transaction).toHaveBeenCalledTimes(1);

    expect(p.calls.txTopicCreate).toHaveBeenCalledTimes(1);
    expect(p.calls.txTopicCreate).toHaveBeenCalledWith({
      data: { title: 'Новая идея', description: 'Что-то совсем новое.' },
      select: { id: true },
    });

    expect(p.calls.txItemCreate).toHaveBeenCalledTimes(3);
    expect(p.calls.txItemCreate).toHaveBeenNthCalledWith(1, {
      data: {
        messageId: 'msg_1',
        topicId: 'topic_dark',
        text: 'хочу тёмную тему',
        discarded: false,
        discardReason: null,
      },
    });
    expect(p.calls.txItemCreate).toHaveBeenNthCalledWith(3, {
      data: {
        messageId: 'msg_3',
        topicId: 'created_topic_1',
        text: 'хочу что-то новое',
        discarded: false,
        discardReason: null,
      },
    });

    expect(p.calls.txMessageUpdateMany).toHaveBeenCalledTimes(1);
    const updateArg = p.calls.txMessageUpdateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
      data: { processedAt: Date };
    };
    expect(updateArg.where.id.in).toEqual(['msg_1', 'msg_2', 'msg_3']);
    expect(updateArg.data.processedAt).toEqual(NOW);

    expect(p.calls.msgUpdateMany).not.toHaveBeenCalled();
  });

  it('сломанный JSON на первой попытке → retry → fallback второй попытки парсится → ok', async () => {
    const p = makePrisma({
      messages: SAMPLE_MESSAGES,
      topics: SAMPLE_TOPICS,
    });
    const r = makeRedis();
    const l = makeLlm(['это не json {{{', GOOD_AGENT_OUTPUT]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    const result = await svc.runDigest();

    expect(result.processed).toBe(3);
    expect(l.call).toHaveBeenCalledTimes(2);
    const userMsg2 = (l.call.mock.calls[1]![0] as LlmCallParams).userMessage;
    expect(userMsg2).toContain('предыдущий ответ не прошёл валидацию');
    expect(p.calls.transaction).toHaveBeenCalledTimes(1);
    expect(p.calls.msgUpdateMany).not.toHaveBeenCalled();
  });

  it('все попытки исчерпаны (LLM throws на обоих) → throws → failedRuns++ для всех messages', async () => {
    const p = makePrisma({
      messages: SAMPLE_MESSAGES,
      topics: SAMPLE_TOPICS,
    });
    const r = makeRedis();
    const l = makeLlm([new Error('llm down'), new Error('llm still down')]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    await expect(svc.runDigest()).rejects.toThrow(/все попытки агента/);

    expect(l.call).toHaveBeenCalledTimes(2);
    expect(p.calls.transaction).not.toHaveBeenCalled();
    expect(p.calls.msgUpdateMany).toHaveBeenCalledTimes(1);
    expect(p.calls.msgUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['msg_1', 'msg_2', 'msg_3'] } },
      data: { failedRuns: { increment: 1 } },
    });
    expect(r.calls.del).toHaveBeenCalledTimes(1);
  });

  it('topicRef ссылается на несуществующий topicId → ref-валидатор отвергает обе попытки → throws → failedRuns++', async () => {
    const badOutput = JSON.stringify({
      newTopics: [],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'что-то', topicRef: 'topic_ghost' }],
        },
      ],
    });
    const p = makePrisma({
      messages: [SAMPLE_MESSAGES[0]!],
      topics: SAMPLE_TOPICS,
    });
    const r = makeRedis();
    const l = makeLlm([badOutput, badOutput]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    await expect(svc.runDigest()).rejects.toThrow(/все попытки агента/);
    expect(l.call).toHaveBeenCalledTimes(2);
    expect(p.calls.transaction).not.toHaveBeenCalled();
    expect(p.calls.msgUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('topicRef = "discard" → item создаётся с discarded=true, topicId=null, discardReason=agent_marked', async () => {
    const discardOutput = JSON.stringify({
      newTopics: [],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'asdfgh нонсенс', topicRef: 'discard' }],
        },
      ],
    });
    const p = makePrisma({
      messages: [SAMPLE_MESSAGES[0]!],
      topics: SAMPLE_TOPICS,
    });
    const r = makeRedis();
    const l = makeLlm([discardOutput]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    const result = await svc.runDigest();

    expect(result.processed).toBe(1);
    expect(p.calls.txItemCreate).toHaveBeenCalledTimes(1);
    expect(p.calls.txItemCreate).toHaveBeenCalledWith({
      data: {
        messageId: 'msg_1',
        topicId: null,
        text: 'asdfgh нонсенс',
        discarded: true,
        discardReason: 'agent_marked',
      },
    });
  });

  it('аномалия newTopics > 0.5 * totalItems → throws → failedRuns++ и транзакция не вызывается', async () => {
    const insaneOutput = JSON.stringify({
      newTopics: [
        { tempId: 'new_1', title: 'A', description: 'd' },
        { tempId: 'new_2', title: 'B', description: 'd' },
        { tempId: 'new_3', title: 'C', description: 'd' },
        { tempId: 'new_4', title: 'D', description: 'd' },
        { tempId: 'new_5', title: 'E', description: 'd' },
      ],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'item', topicRef: 'new_1' }],
        },
      ],
    });
    const existingTopics = [
      { id: 'topic_1', title: 'T1', description: 'd' },
      { id: 'topic_2', title: 'T2', description: 'd' },
      { id: 'topic_3', title: 'T3', description: 'd' },
      { id: 'topic_4', title: 'T4', description: 'd' },
      { id: 'topic_5', title: 'T5', description: 'd' },
    ];
    const p = makePrisma({
      messages: [SAMPLE_MESSAGES[0]!],
      topics: existingTopics,
    });
    const r = makeRedis();
    const l = makeLlm([insaneOutput]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    await expect(svc.runDigest()).rejects.toThrow(/аномалия/);

    expect(p.calls.transaction).not.toHaveBeenCalled();
    expect(p.calls.msgUpdateMany).toHaveBeenCalledTimes(1);
    expect(p.calls.msgUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['msg_1'] } },
      data: { failedRuns: { increment: 1 } },
    });
  });

  it('lock уже занят другим прогоном → { skipped: true, reason: "lock-held" } без LLM', async () => {
    const p = makePrisma({ messages: SAMPLE_MESSAGES });
    const r = makeRedis({ lockHeld: true });
    const l = makeLlm([]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    const result = await svc.runDigest();

    expect(result).toEqual({
      skipped: true,
      processed: 0,
      newTopics: 0,
      reason: 'lock-held',
    });
    expect(l.call).not.toHaveBeenCalled();
    expect(p.calls.findMessages).not.toHaveBeenCalled();
    expect(r.calls.del).not.toHaveBeenCalled();
  });

  it('падение транзакции БД → throws → failedRuns++', async () => {
    const p = makePrisma({
      messages: SAMPLE_MESSAGES,
      topics: SAMPLE_TOPICS,
      txThrows: new Error('db connection lost'),
    });
    const r = makeRedis();
    const l = makeLlm([GOOD_AGENT_OUTPUT]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    await expect(svc.runDigest()).rejects.toThrow(/db connection lost/);

    expect(p.calls.msgUpdateMany).toHaveBeenCalledTimes(1);
    expect(p.calls.msgUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['msg_1', 'msg_2', 'msg_3'] } },
      data: { failedRuns: { increment: 1 } },
    });
    expect(r.calls.del).toHaveBeenCalledTimes(1);
  });

  it('enqueueManualRun делегирует в FeedbackDigestQueue.enqueueManualRun()', async () => {
    const p = makePrisma();
    const r = makeRedis();
    const l = makeLlm([]);
    const q = makeQueue();
    const m = makeMetrics();
    const svc = new FeedbackDigestService(p.prisma, r.redis, l.llm, q.queue, m.metrics);

    const out = await svc.enqueueManualRun();
    expect(out).toEqual({ jobId: 'feedback-digest-manual-mock' });
    expect(q.enqueueManualRun).toHaveBeenCalledTimes(1);
  });
});
