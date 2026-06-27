import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type {
  ChatV2RetrievalService,
  RankedBlockId,
} from './chat-v2-retrieval.service';
import { ChatV2Service } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

type Deps = {
  rrfK: number;
  minPool: number;
  fetchCandidates: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

function makeService(over: Partial<Deps> = {}): {
  svc: ChatV2Service;
  fetchCandidates: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
} {
  const rrfK = over.rrfK ?? 60;
  const minPool = over.minPool ?? 12;

  const findMany =
    over.findMany ??
    vi.fn(async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in.map((id) => ({
        id,
        name: `name-${id}`,
        trustedAnswer: `answer-${id}`,
      })),
    );

  const prisma = {
    ideaBlock: { findMany },
  } as unknown as PrismaService;

  const cfg = {
    getDynamic: vi.fn(async (key: string, _env: unknown, def: number) => {
      if (key === 'rag.rrf_k') return rrfK;
      if (key === 'rag.rerank_min_pool') return minPool;
      return def;
    }),
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;

  const llmCall =
    over.llmCall ??
    vi.fn(async () => ({
      text: '{"keep":[],"dropped":[]}',
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
      tier: 'primary' as const,
    }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const fetchCandidates = over.fetchCandidates ?? vi.fn();
  const retrieval = { fetchCandidates } as unknown as ChatV2RetrievalService;

  const metrics = {
    incRouterBothWays: vi.fn(),
  } as unknown as BusinessMetricsService;
  const accessResolver = {} as unknown as KnowledgeAccessResolver;
  const provenance = {} as unknown as ProvenanceService;

  const svc = new ChatV2Service(
    prisma,
    cfg,
    llm,
    retrieval,
    metrics,
    accessResolver,
    provenance,
  );

  return { svc, fetchCandidates, llmCall, findMany };
}

function ranked(ids: string[]): RankedBlockId[] {
  return ids.map((id, i) => ({
    blockId: id,
    score: 1 - i * 0.01,
    fromGraph: false,
  }));
}

type RunRetrievalCtx = {
  tenantId: string;
  scope: 'org';
  scopeId: string | null;
  query: string;
  kRetrieve: number;
  kContext: number;
  graphHops: number;
  accessWhere: undefined;
};

function callRunRetrieval(
  svc: ChatV2Service,
  input: Record<string, unknown>,
  kRetrieve = 30,
  kContext = 18,
): Promise<string[]> {
  const internal = svc as unknown as {
    runRetrieval: (i: unknown, c: RunRetrievalCtx) => Promise<string[]>;
  };
  return internal.runRetrieval(
    { tenantId: 'org-1', userId: 'u-1', scope: 'org', scopeId: null, ...input },
    {
      tenantId: 'org-1',
      scope: 'org',
      scopeId: null,
      query: (input.query as string) ?? 'q',
      kRetrieve,
      kContext,
      graphHops: 1,
      accessWhere: undefined,
    },
  );
}

describe('ChatV2Service — RRF-слияние подзапросов', () => {
  it('multi-query: блок, высоко в нескольких списках, поднимается за счёт RRF', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(ranked(['a', 'b', 'x1', 'x2']))
      .mockResolvedValueOnce(ranked(['b', 'c', 'y1', 'y2']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, {
      query: 'основной',
      queries: ['основной', 'перефраз'],
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(2);
    expect(out[0]).toBe('b');
    expect(out).toContain('a');
    expect(out).toContain('c');
  });

  it('single-query: порядок = исходный ранжированный список (без RRF)', async () => {
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(['p', 'q', 'r']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, { query: 'один' });

    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    expect(out).toEqual(['p', 'q', 'r']);
  });

  it('precomputedBlockIds: возвращаются как есть, обрезаны до kContext', async () => {
    const fetchCandidates = vi.fn();
    const { svc } = makeService({ fetchCandidates });

    const out = await callRunRetrieval(
      svc,
      { query: 'x', precomputedBlockIds: ['c1', 'c2', 'c3'] },
      30,
      2,
    );

    expect(fetchCandidates).not.toHaveBeenCalled();
    expect(out).toEqual(['c1', 'c2']);
  });
});

describe('ChatV2Service — split K (kRetrieve пул → реранк → kContext контекст)', () => {
  it('fetchCandidates получает limit из kRetrieve (single-query)', async () => {
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(['p', 'q']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    await callRunRetrieval(svc, { query: 'один' }, 30, 18);

    expect(fetchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 30 }),
    );
  });

  it('пул kRetrieve > rerank_min_pool → реранк ФАЙРИТ; выдача ограничена kContext', async () => {
    const pool = Array.from({ length: 30 }, (_, i) => `b${i}`);
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(pool));
    const keep = pool.slice(0, 20);
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({ keep, dropped: [] }),
      modelUsed: 'm',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
      tier: 'primary' as const,
    }));
    const { svc } = makeService({ fetchCandidates, llmCall, minPool: 12 });

    const out = await callRunRetrieval(svc, { query: 'один' }, 30, 18);

    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'rag-rerank' }),
    );
    expect(out.length).toBeLessThanOrEqual(18);
    expect(out).toEqual(keep.slice(0, 18));
  });

  it('пул <= rerank_min_pool → реранк НЕ файрит (нет rag-rerank вызова)', async () => {
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(['a', 'b', 'c']));
    const { svc, llmCall } = makeService({ fetchCandidates, minPool: 12 });

    const out = await callRunRetrieval(svc, { query: 'один' }, 30, 18);

    expect(llmCall).not.toHaveBeenCalled();
    expect(out).toEqual(['a', 'b', 'c']);
  });
});

describe('ChatV2Service — условный LLM-реранк', () => {
  const bigPool = Array.from({ length: 20 }, (_, i) => `b${i}`);

  function callRerank(
    svc: ChatV2Service,
    blockIds: string[],
  ): Promise<string[]> {
    const internal = svc as unknown as {
      conditionalRerank: (a: {
        tenantId: string;
        question: string;
        blockIds: string[];
        conversationSummary?: string | null;
        history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
        reformulations?: ReadonlyArray<string>;
      }) => Promise<string[]>;
    };
    return internal.conditionalRerank({
      tenantId: 'org-1',
      question: 'вопрос',
      blockIds,
    });
  }

  it('пул > minPool → реранк сужает выдачу до keep', async () => {
    const llmCall = vi.fn(async () => ({
      text: '{"keep":["b0","b2","b5"],"dropped":[]}',
      modelUsed: 'm',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
      tier: 'primary' as const,
    }));
    const { svc, llmCall: llm } = makeService({ llmCall, minPool: 12 });

    const out = await callRerank(svc, bigPool);

    expect(llm).toHaveBeenCalledTimes(1);
    expect(out).toEqual(['b0', 'b2', 'b5']);
  });

  it('реранк получает контекст диалога (summary/history/переформулировки) в USER', async () => {
    let captured: { userMessage?: string } = {};
    const llmCall = vi.fn(async (args: { userMessage: string }) => {
      captured = { userMessage: args.userMessage };
      return {
        text: '{"keep":["b0"],"dropped":[]}',
        modelUsed: 'm',
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        durationMs: 1,
        tier: 'primary' as const,
      };
    });
    const { svc } = makeService({ llmCall, minPool: 12 });
    const internal = svc as unknown as {
      conditionalRerank: (a: {
        tenantId: string;
        question: string;
        blockIds: string[];
        conversationSummary?: string | null;
        history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
        reformulations?: ReadonlyArray<string>;
      }) => Promise<string[]>;
    };

    await internal.conditionalRerank({
      tenantId: 'org-1',
      question: 'а у него?',
      blockIds: bigPool,
      conversationSummary: 'Обсуждали проект Альфа.',
      history: [{ role: 'user', content: 'Кто ведёт проект Альфа?' }],
      reformulations: ['а у него?', 'кто отвечает за Альфа'],
    });

    expect(captured.userMessage).toContain('Обсуждали проект Альфа.');
    expect(captured.userMessage).toContain('Кто ведёт проект Альфа?');
    expect(captured.userMessage).toContain('кто отвечает за Альфа');
  });

  it('пул <= minPool → реранк пропущен (llm.call НЕ вызван)', async () => {
    const { svc, llmCall } = makeService({ minPool: 12 });

    const out = await callRerank(svc, ['b0', 'b1', 'b2']);

    expect(llmCall).not.toHaveBeenCalled();
    expect(out).toEqual(['b0', 'b1', 'b2']);
  });

  it('LLM упал → fail-open (исходный список без потерь)', async () => {
    const llmCall = vi.fn(async () => {
      throw new Error('llm down');
    });
    const { svc } = makeService({ llmCall, minPool: 12 });

    const out = await callRerank(svc, bigPool);

    expect(out).toEqual(bigPool);
  });

  it('keep пуст → fail-open (исходный список, реранк не обнуляет выдачу)', async () => {
    const llmCall = vi.fn(async () => ({
      text: '{"keep":[],"dropped":["b0"]}',
      modelUsed: 'm',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
      tier: 'primary' as const,
    }));
    const { svc } = makeService({ llmCall, minPool: 12 });

    const out = await callRerank(svc, bigPool);

    expect(out).toEqual(bigPool);
  });

  it('невалидный JSON → fail-open (исходный список)', async () => {
    const llmCall = vi.fn(async () => ({
      text: 'не json вовсе',
      modelUsed: 'm',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
      tier: 'primary' as const,
    }));
    const { svc } = makeService({ llmCall, minPool: 12 });

    const out = await callRerank(svc, bigPool);

    expect(out).toEqual(bigPool);
  });
});

describe('ChatV2Service — both-ways роутер по классу запроса (Ф3)', () => {
  it('уверенный fact → только семантика, структурный маршрут НЕ подмешан (both-ways off)', async () => {
    const fetchCandidates = vi.fn().mockResolvedValueOnce(ranked(['a', 'b', 'c']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, {
      query: 'что решили по бюджету',
      queries: ['что решили по бюджету'],
      queryClass: 'fact',
      queryClassConfidence: 0.9,
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('низкая уверенность (<0.6) → both-ways: структурный(stub=[]) + семантика, результат не пуст', async () => {
    const fetchCandidates = vi.fn().mockResolvedValueOnce(ranked(['a', 'b']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, {
      query: 'непонятный вопрос',
      queries: ['непонятный вопрос'],
      queryClass: 'topic',
      queryClassConfidence: 0.4,
    });

    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out.length).toBeGreaterThan(0);
  });

  it('class=list → both-ways включён; семантика идёт ОДНИМ standalone-запросом (нет фан-аута по блокам)', async () => {
    const fetchCandidates = vi.fn().mockResolvedValueOnce(ranked(['a', 'b']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, {
      query: 'какие встречи с Ивановым',
      queries: ['какие встречи с Ивановым', 'перефраз 1', 'перефраз 2'],
      queryClass: 'list',
      queryClassConfidence: 0.9,
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    const calledQuery = fetchCandidates.mock.calls[0]?.[0]?.query as string;
    expect(calledQuery).toBe('какие встречи с Ивановым');
    expect(out.length).toBeGreaterThan(0);
  });

  it('class=temporal → семантика одним запросом (фан-аут по блокам не запускается)', async () => {
    const fetchCandidates = vi.fn().mockResolvedValueOnce(ranked(['a']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    await callRunRetrieval(svc, {
      query: 'итоги за месяц',
      queries: ['итоги за месяц', 'перефраз', 'ещё'],
      queryClass: 'temporal',
      queryClassConfidence: 0.9,
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(1);
  });

  it('class=topic с переформулировками → семантический фан-аут по блокам (N запросов + RRF)', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(ranked(['a', 'b']))
      .mockResolvedValueOnce(ranked(['b', 'c']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, {
      query: 'обсуждали реструктуризацию',
      queries: ['обсуждали реструктуризацию', 'перефраз про реструктуризацию'],
      queryClass: 'topic',
      queryClassConfidence: 0.9,
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(2);
    expect(out).toContain('a');
    expect(out).toContain('c');
  });

  it('router_v2_enabled=false → single-route как раньше (фан-аут по классу не гейтится)', async () => {
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(ranked(['a']))
      .mockResolvedValueOnce(ranked(['b']))
      .mockResolvedValueOnce(ranked(['c']));
    const { svc } = makeService({ fetchCandidates, minPool: 100 });
    const internalCfg = (svc as unknown as { cfg: { getDynamic: ReturnType<typeof vi.fn> } }).cfg;
    internalCfg.getDynamic.mockImplementation(
      async (key: string, _env: unknown, def: unknown) => {
        if (key === 'knowledge.router_v2_enabled') return false;
        if (key === 'rag.rrf_k') return 60;
        if (key === 'rag.rerank_min_pool') return 100;
        return def;
      },
    );

    const out = await callRunRetrieval(svc, {
      query: 'какие встречи с Ивановым',
      queries: ['какие встречи с Ивановым', 'перефраз 1', 'перефраз 2'],
      queryClass: 'list',
      queryClassConfidence: 0.9,
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(3);
    expect(out.length).toBeGreaterThan(0);
  });
});
