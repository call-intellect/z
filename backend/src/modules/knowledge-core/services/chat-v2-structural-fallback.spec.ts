import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service, type ChatV2Input } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

function makeService(over?: {
  runStructuralAggregate?: ReturnType<typeof vi.fn>;
  personFindMany?: ReturnType<typeof vi.fn>;
  entityFindMany?: ReturnType<typeof vi.fn>;
  loadContextBlocks?: unknown[];
  llmText?: string;
}): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
  runStructuralAggregate: ReturnType<typeof vi.fn>;
  incStructuralFallbackUsed: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    companyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    person: {
      findMany: over?.personFindMany ?? vi.fn().mockResolvedValue([]),
    },
    entity: {
      findMany: over?.entityFindMany ?? vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const cfg = {
    knowledgeCore: {
      chatV2TopBlocks: 16,
      chatV2GraphHops: 1,
      chatV2SynthesisTimeoutMs: 90_000,
    },
    knowledgeAccess: { enforcement: 'off' as const },
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' as const },
    getDynamic: vi.fn(async (_key: string, _env: unknown, def: unknown) => def),
  } as unknown as TypedConfigService;

  const incStructuralFallbackUsed = vi.fn();
  const metrics = {
    incQueryPlanRetrievalFiltered: vi.fn(),
    incRouterBothWays: vi.fn(),
    incQueryPlanEmptyPool: vi.fn(),
    incStructuralFallbackUsed,
  } as unknown as BusinessMetricsService;

  const llmCall = vi.fn(async () => ({
    text: over?.llmText ?? 'Ответ по фактам.',
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary' as const,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const runStructuralAggregate =
    over?.runStructuralAggregate ?? vi.fn().mockResolvedValue([]);
  const retrieval = {
    fetchCandidates: vi.fn().mockResolvedValue([]),
    selectTopThemes: vi.fn().mockResolvedValue([]),
    poolByThemes: vi.fn().mockResolvedValue([]),
    runStructuralAggregate,
    listEpisodesByActors: vi.fn().mockResolvedValue([]),
  } as unknown as ChatV2RetrievalService;

  const accessResolver = {
    resolveAccessibleGroups: vi.fn(),
    buildAccessWhere: vi.fn(),
    partitionBlockIdsByAccess: vi.fn(),
  } as unknown as KnowledgeAccessResolver;

  const provenance = {
    resolveByRawEventIds: vi.fn(async () => new Map()),
  } as unknown as ProvenanceService;

  const svc = new ChatV2Service(
    prisma,
    cfg,
    llm,
    retrieval,
    metrics,
    accessResolver,
    provenance,
  );

  if (over?.loadContextBlocks !== undefined) {
    const internal = svc as unknown as {
      loadContextBlocks: (...a: unknown[]) => Promise<unknown[]>;
      buildReasoningChains: (...a: unknown[]) => Promise<unknown[]>;
      loadContradictingBlocks: (...a: unknown[]) => Promise<unknown[]>;
      buildScopeAddon: (...a: unknown[]) => Promise<string>;
    };
    vi.spyOn(internal, 'loadContextBlocks').mockResolvedValue(
      over.loadContextBlocks,
    );
    vi.spyOn(internal, 'buildReasoningChains').mockResolvedValue([]);
    vi.spyOn(internal, 'loadContradictingBlocks').mockResolvedValue([]);
    vi.spyOn(internal, 'buildScopeAddon').mockResolvedValue('');
  }

  return { svc, llmCall, runStructuralAggregate, incStructuralFallbackUsed };
}

const RETRIEVAL_CTX = {
  tenantId: 'org-1',
  scope: 'org' as const,
  scopeId: null,
  query: 'что решили по пилоту',
  kRetrieve: 16,
  kContext: 10,
  graphHops: 1,
  accessWhere: undefined,
};

function factInput(personIds: string[], entityIds: string[] = []): ChatV2Input {
  return {
    tenantId: 'org-1',
    userId: 'user-1',
    scope: 'org',
    scopeId: null,
    query: 'что решили по пилоту',
    queryClass: 'fact',
    queryClassConfidence: 0.95,
    structuralFilters: {
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      entityIds,
      personIds,
      themeBranches: [],
      bitemporalActiveOnly: false,
    },
  };
}

describe('ChatV2Service — структурный маршрут для fact/topic (Пакет B)', () => {
  it('queryClass=fact + personIds → runStructuralRoute отдаёт blockId структурной ноги + метрика', async () => {
    const runStructuralAggregate = vi
      .fn()
      .mockResolvedValue(['blk-1', 'blk-2']);
    const { svc, runStructuralAggregate: agg, incStructuralFallbackUsed } =
      makeService({ runStructuralAggregate });

    const internal = svc as unknown as {
      runStructuralRoute: (
        input: ChatV2Input,
        ctx: typeof RETRIEVAL_CTX,
      ) => Promise<string[]>;
    };
    const ids = await internal.runStructuralRoute(
      factInput(['p-mikhail']),
      RETRIEVAL_CTX,
    );

    expect(ids).toEqual(['blk-1', 'blk-2']);
    expect(agg).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        personIds: ['p-mikhail'],
        entityIds: [],
      }),
    );
    expect(incStructuralFallbackUsed).toHaveBeenCalledWith({
      queryClass: 'fact',
    });
  });

  it('queryClass=topic + entityIds → структурная нога срабатывает, метрика topic', async () => {
    const runStructuralAggregate = vi.fn().mockResolvedValue(['blk-9']);
    const { svc, incStructuralFallbackUsed } = makeService({
      runStructuralAggregate,
    });

    const internal = svc as unknown as {
      runStructuralRoute: (
        input: ChatV2Input,
        ctx: typeof RETRIEVAL_CTX,
      ) => Promise<string[]>;
    };
    const input = factInput([], ['e-acme']);
    input.queryClass = 'topic';
    const ids = await internal.runStructuralRoute(input, RETRIEVAL_CTX);

    expect(ids).toEqual(['blk-9']);
    expect(incStructuralFallbackUsed).toHaveBeenCalledWith({
      queryClass: 'topic',
    });
  });

  it('queryClass=fact без person/entity → [] и метрика НЕ инкрементится', async () => {
    const { svc, runStructuralAggregate, incStructuralFallbackUsed } =
      makeService();
    const internal = svc as unknown as {
      runStructuralRoute: (
        input: ChatV2Input,
        ctx: typeof RETRIEVAL_CTX,
      ) => Promise<string[]>;
    };
    const ids = await internal.runStructuralRoute(
      factInput([], []),
      RETRIEVAL_CTX,
    );
    expect(ids).toEqual([]);
    expect(runStructuralAggregate).not.toHaveBeenCalled();
    expect(incStructuralFallbackUsed).not.toHaveBeenCalled();
  });

  it('регресс: queryClass=temporal → структурная агрегация НЕ вызывается (свой маршрут)', async () => {
    const { svc, runStructuralAggregate } = makeService();
    const internal = svc as unknown as {
      runStructuralRoute: (
        input: ChatV2Input,
        ctx: typeof RETRIEVAL_CTX,
      ) => Promise<string[]>;
    };
    const input = factInput(['p-x']);
    input.queryClass = 'temporal';
    const ids = await internal.runStructuralRoute(input, RETRIEVAL_CTX);
    expect(ids).toEqual([]);
    expect(runStructuralAggregate).not.toHaveBeenCalled();
  });
});

describe('ChatV2Service — честный именованный fallback на пустом пуле (Пакет B Ф2)', () => {
  it('fact + personIds, пустой пул → сообщение называет человека', async () => {
    const personFindMany = vi
      .fn()
      .mockResolvedValue([{ name: 'Михаил Петров' }]);
    const { svc } = makeService({
      loadContextBlocks: [],
      personFindMany,
    });

    const out = await svc.ask(factInput(['p-mikhail']));

    expect(out.modelUsed).toBe('none');
    expect(out.message).toContain('Михаил Петров');
    expect(out.message).toContain('в памяти ничего не нашлось');
    expect(personFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'org-1',
          id: { in: ['p-mikhail'] },
        }),
      }),
    );
  });

  it('fact + entityIds, пустой пул → сообщение называет компанию', async () => {
    const entityFindMany = vi
      .fn()
      .mockResolvedValue([{ canonicalName: 'Акме' }]);
    const { svc } = makeService({
      loadContextBlocks: [],
      entityFindMany,
    });

    const out = await svc.ask(factInput([], ['e-acme']));

    expect(out.message).toContain('компании «Акме»');
    expect(out.message).toContain('в памяти ничего не нашлось');
  });

  it('fact + personIds, но lookup имени упал → общий честный текст (fail-open)', async () => {
    const personFindMany = vi.fn().mockRejectedValue(new Error('db down'));
    const { svc } = makeService({
      loadContextBlocks: [],
      personFindMany,
    });

    const out = await svc.ask(factInput(['p-mikhail']));

    expect(out.modelUsed).toBe('none');
    expect(out.message).toContain('ничего не нашлось');
    expect(out.message).not.toContain('Михаил');
  });

  it('регресс: без person/entity + пустой пул → generic «Недостаточно данных»', async () => {
    const { svc } = makeService({ loadContextBlocks: [] });
    const input = factInput([], []);
    input.structuralFilters = null;
    const out = await svc.ask(input);
    expect(out.message).toContain('Недостаточно данных');
  });
});
