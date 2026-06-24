import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
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
  iterativeEnabled?: boolean;
  coldStartMin?: number;
  canonicalCount?: number;
  llmByTaskType?: Record<string, () => LlmResult | Promise<LlmResult>>;
  ideaBlockFindMany?: ReturnType<typeof vi.fn>;
};

function makeService(over: Over = {}): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
} {
  const count = vi.fn(async () => over.canonicalCount ?? 100);
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

  const cfg = {
    getDynamic: vi.fn(async (key: string, _env: unknown, def: unknown) => {
      if (key === 'rag.iterative_enabled') return over.iterativeEnabled ?? true;
      if (key === 'rag.cold_start_min_blocks') return over.coldStartMin ?? 20;
      return def;
    }),
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;

  const llmCall = vi.fn(async (args: { taskType: string }) => {
    const handler = over.llmByTaskType?.[args.taskType];
    if (handler) return handler();
    return llmResult('{}');
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const retrieval = {
    fetchCandidates: vi.fn(),
  } as unknown as ChatV2RetrievalService;
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

  return { svc, llmCall, count };
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
  topK: 20,
  graphHops: 1,
  accessWhere: undefined,
};

function asInternal(svc: ChatV2Service): {
  routeComplexity: (
    tenantId: string,
    q: string,
  ) => Promise<'none' | 'single' | 'iterative'>;
  planSteps: (
    tenantId: string,
    q: string,
  ) => Promise<Array<{ goal: string; query: string }>>;
  judgeSufficiency: (
    tenantId: string,
    q: string,
    ids: string[],
  ) => Promise<{ sufficient: boolean; nextQuery: string }>;
  retrieveWithOptionalPlan: (i: unknown, c: unknown) => Promise<string[]>;
  runRetrieval: (i: unknown, c: unknown) => Promise<string[]>;
} {
  return svc as never;
}

describe('ChatV2Service — routeComplexity (Ф4.4)', () => {
  it('llm вернул iterative → iterative', async () => {
    const { svc } = makeService({
      llmByTaskType: {
        'rag-route': () =>
          llmResult(
            '{"needsSearch":true,"complexity":"iterative","clarifyNeeded":false}',
          ),
      },
    });
    const out = await asInternal(svc).routeComplexity('org-1', 'вопрос');
    expect(out).toBe('iterative');
  });

  it('llm упал → single (fail-open, не none)', async () => {
    const { svc } = makeService({
      llmByTaskType: {
        'rag-route': () => {
          throw new Error('llm down');
        },
      },
    });
    const out = await asInternal(svc).routeComplexity('org-1', 'вопрос');
    expect(out).toBe('single');
  });

  it('невалидный JSON → single (fail-open)', async () => {
    const { svc } = makeService({
      llmByTaskType: { 'rag-route': () => llmResult('не json') },
    });
    const out = await asInternal(svc).routeComplexity('org-1', 'вопрос');
    expect(out).toBe('single');
  });
});

describe('ChatV2Service — planSteps (Ф4.5)', () => {
  it('llm вернул шаги → шаги (обрезаны до 4)', async () => {
    const { svc } = makeService({
      llmByTaskType: {
        'rag-plan': () =>
          llmResult(
            '{"steps":[{"goal":"g1","query":"q1"},{"goal":"g2","query":"q2"},{"goal":"g3","query":"q3"},{"goal":"g4","query":"q4"},{"goal":"g5","query":"q5"}]}',
          ),
      },
    });
    const steps = await asInternal(svc).planSteps('org-1', 'вопрос');
    expect(steps.map((s) => s.query)).toEqual(['q1', 'q2', 'q3', 'q4']);
  });

  it('llm упал → один шаг = исходный вопрос (fail-open)', async () => {
    const { svc } = makeService({
      llmByTaskType: {
        'rag-plan': () => {
          throw new Error('llm down');
        },
      },
    });
    const steps = await asInternal(svc).planSteps('org-1', 'исходный');
    expect(steps).toEqual([{ goal: '', query: 'исходный' }]);
  });
});

describe('ChatV2Service — judgeSufficiency (Ф4.7)', () => {
  it('llm вернул {sufficient:false,nextQuery:x} → проброшено', async () => {
    const { svc } = makeService({
      llmByTaskType: {
        'rag-sufficiency': () =>
          llmResult('{"sufficient":false,"gaps":["g"],"nextQuery":"x"}'),
      },
    });
    const out = await asInternal(svc).judgeSufficiency('org-1', 'вопрос', [
      'b1',
    ]);
    expect(out).toEqual({ sufficient: false, nextQuery: 'x' });
  });

  it('llm упал → {sufficient:true} (fail-open, не зацикливаемся)', async () => {
    const { svc } = makeService({
      llmByTaskType: {
        'rag-sufficiency': () => {
          throw new Error('llm down');
        },
      },
    });
    const out = await asInternal(svc).judgeSufficiency('org-1', 'вопрос', [
      'b1',
    ]);
    expect(out).toEqual({ sufficient: true, nextQuery: '' });
  });
});

describe('ChatV2Service — retrieveWithOptionalPlan (Ф4 интеграция)', () => {
  it('(а) iterative_enabled=false → один runRetrieval, без LLM-ветки', async () => {
    const { svc, llmCall } = makeService({ iterativeEnabled: false });
    const internal = asInternal(svc);
    const runRetrieval = vi
      .spyOn(internal, 'runRetrieval')
      .mockResolvedValue(['single-1']);

    const out = await internal.retrieveWithOptionalPlan(
      { ...BASE_INPUT, query: 'q' },
      { ...BASE_CTX, query: 'q' },
    );

    expect(runRetrieval).toHaveBeenCalledTimes(1);
    expect(llmCall).not.toHaveBeenCalled();
    expect(out).toEqual(['single-1']);
  });

  it('(б) cold-start (count<min) → один runRetrieval, без LLM-ветки', async () => {
    const { svc, llmCall, count } = makeService({
      canonicalCount: 5,
      coldStartMin: 20,
    });
    const internal = asInternal(svc);
    const runRetrieval = vi
      .spyOn(internal, 'runRetrieval')
      .mockResolvedValue(['single-1']);

    const out = await internal.retrieveWithOptionalPlan(
      { ...BASE_INPUT, query: 'q' },
      { ...BASE_CTX, query: 'q' },
    );

    expect(count).toHaveBeenCalledTimes(1);
    expect(runRetrieval).toHaveBeenCalledTimes(1);
    expect(llmCall).not.toHaveBeenCalled();
    expect(out).toEqual(['single-1']);
  });

  it("(в) route='single' → один runRetrieval, план не строится", async () => {
    const { svc } = makeService({
      canonicalCount: 100,
      llmByTaskType: {
        'rag-route': () =>
          llmResult(
            '{"needsSearch":true,"complexity":"single","clarifyNeeded":false}',
          ),
        'rag-plan': () => {
          throw new Error('plan не должен вызываться');
        },
      },
    });
    const internal = asInternal(svc);
    const runRetrieval = vi
      .spyOn(internal, 'runRetrieval')
      .mockResolvedValue(['single-1']);

    const out = await internal.retrieveWithOptionalPlan(
      { ...BASE_INPUT, query: 'q' },
      { ...BASE_CTX, query: 'q' },
    );

    expect(runRetrieval).toHaveBeenCalledTimes(1);
    expect(out).toEqual(['single-1']);
  });

  it("(г) route='iterative' + 2 шага → runRetrieval на каждый шаг, объединение id (Set)", async () => {
    const { svc } = makeService({
      canonicalCount: 100,
      llmByTaskType: {
        'rag-route': () =>
          llmResult(
            '{"needsSearch":true,"complexity":"iterative","clarifyNeeded":false}',
          ),
        'rag-plan': () =>
          llmResult(
            '{"steps":[{"goal":"g1","query":"step-a"},{"goal":"g2","query":"step-b"}]}',
          ),
        'rag-sufficiency': () =>
          llmResult('{"sufficient":true,"gaps":[],"nextQuery":""}'),
      },
    });
    const internal = asInternal(svc);
    const runRetrieval = vi
      .spyOn(internal, 'runRetrieval')
      .mockImplementation(async (i: unknown) => {
        const q = (i as { query: string }).query;
        if (q === 'step-a') return ['a1', 'shared'];
        if (q === 'step-b') return ['b1', 'shared'];
        return [];
      });

    const out = await internal.retrieveWithOptionalPlan(
      { ...BASE_INPUT, query: 'агрегат' },
      { ...BASE_CTX, query: 'агрегат' },
    );

    expect(runRetrieval).toHaveBeenCalledTimes(2);
    expect(new Set(out)).toEqual(new Set(['a1', 'shared', 'b1']));
  });

  it('сторож: nextQuery, совпадающий с шагом плана, НЕ запускает повторный runRetrieval', async () => {
    const { svc } = makeService({
      canonicalCount: 100,
      llmByTaskType: {
        'rag-route': () =>
          llmResult(
            '{"needsSearch":true,"complexity":"iterative","clarifyNeeded":false}',
          ),
        'rag-plan': () =>
          llmResult('{"steps":[{"goal":"g","query":"повтор"}]}'),
        // судья просит nextQuery == уже выполненный шаг → сторож блокирует.
        'rag-sufficiency': () =>
          llmResult('{"sufficient":false,"gaps":["g"],"nextQuery":"повтор"}'),
      },
    });
    const internal = asInternal(svc);
    const runRetrieval = vi
      .spyOn(internal, 'runRetrieval')
      .mockResolvedValue(['only']);

    const out = await internal.retrieveWithOptionalPlan(
      { ...BASE_INPUT, query: 'агрегат' },
      { ...BASE_CTX, query: 'агрегат' },
    );

    expect(runRetrieval).toHaveBeenCalledTimes(1);
    expect(out).toEqual(['only']);
  });
});
