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

  const metrics = {} as unknown as BusinessMetricsService;
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
  topK: number;
  graphHops: number;
  accessWhere: undefined;
};

function callRunRetrieval(
  svc: ChatV2Service,
  input: Record<string, unknown>,
  topK = 20,
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
      topK,
      graphHops: 1,
      accessWhere: undefined,
    },
  );
}

describe('ChatV2Service — RRF-слияние подзапросов (Ф4.6 Задача 1)', () => {
  it('multi-query: блок, высоко в нескольких списках, поднимается за счёт RRF', async () => {
    // q1: a высоко, b ниже. q2: b высоко, c ниже. b есть в обоих → RRF поднимает.
    const fetchCandidates = vi
      .fn()
      .mockResolvedValueOnce(ranked(['a', 'b', 'x1', 'x2']))
      .mockResolvedValueOnce(ranked(['b', 'c', 'y1', 'y2']));
    // minPool большой → реранк не вмешивается, видим чистый RRF-порядок.
    const { svc } = makeService({ fetchCandidates, minPool: 100 });

    const out = await callRunRetrieval(svc, {
      query: 'основной',
      queries: ['основной', 'перефраз'],
    });

    expect(fetchCandidates).toHaveBeenCalledTimes(2);
    // b встречается в обоих списках → его RRF-сумма максимальна → он первый.
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

  it('precomputedBlockIds: возвращаются как есть (без fetchCandidates)', async () => {
    const fetchCandidates = vi.fn();
    const { svc } = makeService({ fetchCandidates });

    const out = await callRunRetrieval(svc, {
      query: 'x',
      precomputedBlockIds: ['c1', 'c2'],
    });

    expect(fetchCandidates).not.toHaveBeenCalled();
    expect(out).toEqual(['c1', 'c2']);
  });
});

describe('ChatV2Service — условный LLM-реранк (Ф4.6 Задача 2)', () => {
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
