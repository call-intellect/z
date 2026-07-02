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

type LlmResult = {
  text: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  tier: 'primary';
};

function llmResult(text: string): LlmResult {
  return {
    text,
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 1,
    outputTokens: 1,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary',
  };
}

type Over = {
  minPool?: number;
  fetchCandidates?: ReturnType<typeof vi.fn>;
  llmByTaskType?: Record<string, () => LlmResult | Promise<LlmResult>>;
  ideaBlockFindMany?: ReturnType<typeof vi.fn>;
};

function makeService(over: Over = {}): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  fetchCandidates: ReturnType<typeof vi.fn>;
} {
  const count = vi.fn(async () => 100);
  const findMany =
    over.ideaBlockFindMany ??
    vi.fn(async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in.map((id) => ({
        id,
        name: `name-${id}`,
        trustedAnswer: `answer-${id}`,
      })),
    );

  const prisma = {
    ideaBlock: { count, findMany },
  } as unknown as PrismaService;

  const minPool = over.minPool ?? 12;
  const cfg = {
    getDynamic: vi.fn(async (key: string, _env: unknown, def: unknown) => {
      if (key === 'rag.rerank_min_pool') return minPool;
      if (key === 'rag.rrf_k') return 60;
      if (key === 'knowledge.chatV2CascadeEnabled') return false;
      return def;
    }),
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;

  const llmCall = vi.fn(async (args: { taskType: string }) => {
    const handler = over.llmByTaskType?.[args.taskType];
    if (handler) return handler();
    return llmResult('{"keep":[],"dropped":[]}');
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const fetchCandidates = over.fetchCandidates ?? vi.fn();
  const retrieval = {
    fetchCandidates,
  } as unknown as ChatV2RetrievalService;
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

  return { svc, llmCall, count, fetchCandidates };
}

const BASE_INPUT = {
  tenantId: 'org-1',
  userId: 'u-1',
  scope: 'org' as const,
  scopeId: null,
};

const BASE_CTX = {
  tenantId: 'org-1',
  scope: 'org' as const,
  scopeId: null,
  kRetrieve: 30,
  kContext: 18,
  graphHops: 1,
  accessWhere: undefined,
};

function ranked(ids: string[]): RankedBlockId[] {
  return ids.map((id, i) => ({
    blockId: id,
    score: 1 - i * 0.01,
    fromGraph: false,
  }));
}

function asInternal(svc: ChatV2Service): {
  runRetrieval: (
    i: unknown,
    c: unknown,
  ) => Promise<{ blockIds: string[]; approximate: boolean }>;
} {
  return svc as never;
}

function llmTaskTypes(llmCall: ReturnType<typeof vi.fn>): string[] {
  return llmCall.mock.calls.map(
    (c) => (c[0] as { taskType: string }).taskType,
  );
}

describe('ChatV2Service — одношаговый retrieval (второй цикл удалён)', () => {
  it('runRetrieval НЕ делает rag-route / rag-plan / rag-sufficiency вызовов', async () => {
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(['a', 'b', 'c']));
    const { svc, llmCall } = makeService({ fetchCandidates, minPool: 100 });

    await asInternal(svc).runRetrieval(
      { ...BASE_INPUT, query: 'агрегатный вопрос по всем встречам' },
      { ...BASE_CTX, query: 'агрегатный вопрос по всем встречам' },
    );

    const types = llmTaskTypes(llmCall);
    expect(types).not.toContain('rag-route');
    expect(types).not.toContain('rag-plan');
    expect(types).not.toContain('rag-sufficiency');
  });

  it('одношаговый путь: fetchCandidates вызван один раз для single-query', async () => {
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(['a', 'b']));
    const { svc, count } = makeService({ fetchCandidates, minPool: 100 });

    const out = await asInternal(svc).runRetrieval(
      { ...BASE_INPUT, query: 'q' },
      { ...BASE_CTX, query: 'q' },
    );

    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    expect(out.blockIds).toEqual(['a', 'b']);
  });

  it('большой пул > rerank_min_pool → единственный LLM-вызов в retrieval — rag-rerank', async () => {
    const pool = Array.from({ length: 30 }, (_, i) => `b${i}`);
    const fetchCandidates = vi.fn().mockResolvedValue(ranked(pool));
    const { svc, llmCall } = makeService({
      fetchCandidates,
      minPool: 12,
      llmByTaskType: {
        'rag-rerank': () =>
          llmResult(
            JSON.stringify({ keep: pool.slice(0, 18), dropped: [] }),
          ),
      },
    });

    const out = await asInternal(svc).runRetrieval(
      { ...BASE_INPUT, query: 'агрегат' },
      { ...BASE_CTX, query: 'агрегат' },
    );

    const types = llmTaskTypes(llmCall);
    expect(types).toEqual(['rag-rerank']);
    expect(out.blockIds.length).toBeLessThanOrEqual(18);
  });
});
