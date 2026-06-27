import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service, type ChatV2Input } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

function makeService(retrievalOver?: {
  selectTopThemes?: ReturnType<typeof vi.fn>;
  poolByThemes?: ReturnType<typeof vi.fn>;
}): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
  selectTopThemes: ReturnType<typeof vi.fn>;
  poolByThemes: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    companyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
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

  const metrics = {
    incQueryPlanRetrievalFiltered: vi.fn(),
    incRouterBothWays: vi.fn(),
    incQueryPlanEmptyPool: vi.fn(),
  } as unknown as BusinessMetricsService;

  const llmCall = vi.fn(async () => ({
    text: 'Готовый обзорный ответ.',
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary' as const,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const selectTopThemes = retrievalOver?.selectTopThemes ?? vi.fn().mockResolvedValue([]);
  const poolByThemes = retrievalOver?.poolByThemes ?? vi.fn().mockResolvedValue([]);
  const retrieval = {
    fetchCandidates: vi.fn(),
    selectTopThemes,
    poolByThemes,
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

  const block = {
    id: 'b-1',
    name: 'seed',
    signalType: 'fact',
    trustedAnswer: 'Утверждение',
    dataClass: 'public' as const,
    primaryMeetingEvidence: null,
  };
  const internal = svc as unknown as {
    loadContextBlocks: (...a: unknown[]) => Promise<unknown[]>;
    buildReasoningChains: (...a: unknown[]) => Promise<unknown[]>;
    loadContradictingBlocks: (...a: unknown[]) => Promise<unknown[]>;
    buildScopeAddon: (...a: unknown[]) => Promise<string>;
  };
  vi.spyOn(internal, 'loadContextBlocks').mockResolvedValue([block]);
  vi.spyOn(internal, 'buildReasoningChains').mockResolvedValue([]);
  vi.spyOn(internal, 'loadContradictingBlocks').mockResolvedValue([]);
  vi.spyOn(internal, 'buildScopeAddon').mockResolvedValue('');

  return { svc, llmCall, selectTopThemes, poolByThemes };
}

function userMessageOf(llmCall: ReturnType<typeof vi.fn>): string {
  const call = llmCall.mock.calls[0];
  const arg = call?.[0] as { userMessage?: string } | undefined;
  return arg?.userMessage ?? '';
}

const overviewInput: ChatV2Input = {
  tenantId: 'org-1',
  userId: 'user-1',
  scope: 'org',
  scopeId: null,
  query: 'что у нас по продажам',
  precomputedBlockIds: ['b-1'],
  queryClass: 'overview',
  queryClassConfidence: 0.9,
};

type Ctx = {
  tenantId: string;
  scope: 'org';
  scopeId: string | null;
  query: string;
  kRetrieve: number;
  kContext: number;
  graphHops: number;
  accessWhere: undefined;
};

function callRunStructuralRoute(
  svc: ChatV2Service,
  input: Record<string, unknown>,
): Promise<string[]> {
  const internal = svc as unknown as {
    runStructuralRoute: (i: unknown, c: Ctx) => Promise<string[]>;
  };
  return internal.runStructuralRoute(
    { tenantId: 'org-1', userId: 'u-1', scope: 'org', scopeId: null, ...input },
    {
      tenantId: 'org-1',
      scope: 'org',
      scopeId: null,
      query: (input.query as string) ?? 'q',
      kRetrieve: 30,
      kContext: 18,
      graphHops: 1,
      accessWhere: undefined,
    },
  );
}

describe('ChatV2Service.runStructuralRoute — overview (мост К4, Ф6)', () => {
  it('class=overview → selectTopThemes → poolByThemes → blockIds', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([
      { id: 'th-1', summary: 's1' },
      { id: 'th-2', summary: 's2' },
    ]);
    const poolByThemes = vi.fn().mockResolvedValue(['b1', 'b2', 'b3']);
    const { svc } = makeService({ selectTopThemes, poolByThemes });

    const out = await callRunStructuralRoute(svc, {
      query: 'обзор продаж',
      queryClass: 'overview',
    });

    expect(selectTopThemes).toHaveBeenCalledTimes(1);
    expect(selectTopThemes).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', query: 'обзор продаж' }),
    );
    expect(poolByThemes).toHaveBeenCalledWith('org-1', ['th-1', 'th-2'], 30);
    expect(out).toEqual(['b1', 'b2', 'b3']);
  });

  it('overview без тем → [] и poolByThemes не зовётся', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([]);
    const poolByThemes = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ selectTopThemes, poolByThemes });

    const out = await callRunStructuralRoute(svc, { queryClass: 'overview' });

    expect(out).toEqual([]);
    expect(poolByThemes).not.toHaveBeenCalled();
  });

  it('class=fact → selectTopThemes НЕ вызывается (не overview-маршрут)', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ selectTopThemes });

    await callRunStructuralRoute(svc, { queryClass: 'fact' });

    expect(selectTopThemes).not.toHaveBeenCalled();
  });

  it('class=topic → selectTopThemes НЕ вызывается', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ selectTopThemes });

    await callRunStructuralRoute(svc, { queryClass: 'topic' });

    expect(selectTopThemes).not.toHaveBeenCalled();
  });

  it('передаёт themeBranches как branches-фильтр', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([{ id: 'th-1', summary: 's' }]);
    const poolByThemes = vi.fn().mockResolvedValue(['b1']);
    const { svc } = makeService({ selectTopThemes, poolByThemes });

    await callRunStructuralRoute(svc, {
      queryClass: 'overview',
      structuralFilters: {
        dateFrom: null,
        dateTo: null,
        signalTypes: [],
        entityIds: [],
        personIds: [],
        themeBranches: ['sales'],
        bitemporalActiveOnly: false,
      },
    });

    expect(selectTopThemes).toHaveBeenCalledWith(
      expect.objectContaining({ branches: ['sales'] }),
    );
  });
});

describe('ChatV2Service — overview-ветка контекста карты тем (мост К4, Ф6)', () => {
  it('class=overview + темы с summary → markdown «Карта тем» с маркером [ТЕМА:]', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([
      { id: 'th-sales', summary: 'ПРОДАЖИ-СВОДКА: растём.' },
      { id: 'th-mkt', summary: 'МАРКЕТИНГ-СВОДКА: новые лиды.' },
    ]);
    const { svc, llmCall, selectTopThemes: spy } = makeService({ selectTopThemes });

    await svc.ask({ ...overviewInput });

    // overview зовёт selectTopThemes и в structural-маршруте, и в context-ветке.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).toContain('Карта тем');
    expect(userMsg).toContain('[ТЕМА: th-sales]');
    expect(userMsg).toContain('ПРОДАЖИ-СВОДКА: растём.');
    expect(userMsg).toContain('[ТЕМА: th-mkt]');
    expect(userMsg).toContain('МАРКЕТИНГ-СВОДКА: новые лиды.');
  });

  it('class=overview, тем нет → секции «Карта тем» нет', async () => {
    const { svc, llmCall } = makeService({
      selectTopThemes: vi.fn().mockResolvedValue([]),
    });

    const out = await svc.ask({ ...overviewInput });

    expect(out.message).toBe('Готовый обзорный ответ.');
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Карта тем');
  });

  it('class=overview, темы есть но summary пусты → карты нет', async () => {
    const { svc, llmCall } = makeService({
      selectTopThemes: vi
        .fn()
        .mockResolvedValue([{ id: 'th-1', summary: '   ' }, { id: 'th-2', summary: null }]),
    });

    await svc.ask({ ...overviewInput });

    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Карта тем');
  });

  it('класс НЕ overview → selectTopThemes context-ветки не зовётся', async () => {
    const selectTopThemes = vi.fn().mockResolvedValue([]);
    const { svc } = makeService({ selectTopThemes });

    await svc.ask({ ...overviewInput, queryClass: 'fact' });

    // ни structural-маршрут, ни context-ветка не должны звать темы при class=fact.
    expect(selectTopThemes).not.toHaveBeenCalled();
  });

  it('падение selectTopThemes НЕ валит ответ (семантика отвечает)', async () => {
    const selectTopThemes = vi.fn().mockRejectedValue(new Error('db down'));
    const { svc, llmCall } = makeService({ selectTopThemes });

    const out = await svc.ask({ ...overviewInput });

    expect(out.message).toBe('Готовый обзорный ответ.');
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Карта тем');
  });
});
