import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service, type ChatV2Input } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

const RANKED = [
  { blockId: 'b1', score: 1, fromGraph: false },
  { blockId: 'b2', score: 0.9, fromGraph: false },
  { blockId: 'b3', score: 0.8, fromGraph: false },
  { blockId: 'b4', score: 0.7, fromGraph: false },
  { blockId: 'b5', score: 0.6, fromGraph: false },
  { blockId: 'b6', score: 0.5, fromGraph: false },
];

function makeService(
  baseFloor: boolean,
  opts?: { baseThrows?: boolean },
): {
  svc: ChatV2Service;
  fetchCandidates: ReturnType<typeof vi.fn>;
} {
  const fetchCandidates = vi.fn(async (args: { graphHops?: number }) => {
    if (opts?.baseThrows && args?.graphHops === 0) {
      throw new Error('base fetch down');
    }
    return RANKED;
  });
  const prisma = {
    ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'knowledge.chatV2BaseRecallFloor') return baseFloor;
    if (key === 'knowledge.chatV2CascadeEnabled') return false;
    return def;
  });
  const cfg = {
    knowledgeCore: {
      chatV2TopBlocks: 16,
      chatV2GraphHops: 1,
      chatV2SynthesisTimeoutMs: 90_000,
    },
    knowledgeAccess: { enforcement: 'off' as const },
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' as const },
    getDynamic,
  } as unknown as TypedConfigService;

  const metrics = {
    incQueryPlanRetrievalFiltered: vi.fn(),
    incRouterBothWays: vi.fn(),
    incQueryPlanEmptyPool: vi.fn(),
    incStructuralFallbackUsed: vi.fn(),
  } as unknown as BusinessMetricsService;

  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const retrieval = {
    fetchCandidates,
    selectTopThemes: vi.fn().mockResolvedValue([]),
    poolByThemes: vi.fn().mockResolvedValue([]),
    runStructuralAggregate: vi.fn().mockResolvedValue([]),
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
  return { svc, fetchCandidates };
}

const CTX = {
  tenantId: 'org-1',
  scope: 'org' as const,
  scopeId: null,
  query: 'кто ЛПР в логистик плюс',
  kRetrieve: 30,
  kContext: 18,
  graphHops: 1,
  graphAlwaysExpand: true,
  filterMode: 'boost' as const,
  filterBoostWeight: 0.3,
  entityLinkHops: 1,
  graphCypherRecall: true,
  graphCypherMaxDepth: 3,
  aggregationMode: false,
  accessWhere: undefined,
};

function input(over?: Partial<ChatV2Input>): ChatV2Input {
  return {
    tenantId: 'org-1',
    userId: 'user-1',
    scope: 'org',
    scopeId: null,
    query: 'кто ЛПР в логистик плюс',
    queryClass: 'fact',
    queryClassConfidence: 0.95,
    ...over,
  };
}

async function runRetrieval(
  svc: ChatV2Service,
  over?: Partial<ChatV2Input>,
): Promise<{ blockIds: string[] }> {
  return (await (
    svc as unknown as {
      runRetrieval: (
        i: ChatV2Input,
        c: typeof CTX,
        t?: unknown,
      ) => Promise<{ blockIds: string[] }>;
    }
  ).runRetrieval(input(over), CTX, undefined)) as { blockIds: string[] };
}

describe('ChatV2Service — base-recall-floor', () => {
  it('floor ON → детерминированный base-подъём: limit=kRetrieve, graphHops=0, без структурного фильтра', async () => {
    const { svc, fetchCandidates } = makeService(true);
    await runRetrieval(svc);

    const baseCall = fetchCandidates.mock.calls.find(
      (c) => c[0]?.limit === 30 && c[0]?.graphHops === 0,
    );
    expect(baseCall).toBeDefined();
    const arg = baseCall![0];
    expect(arg.query).toBe('кто ЛПР в логистик плюс');
    expect(arg.graphCypherRecall).toBe(false);
    expect(arg.entityLinkHops).toBe(0);
    expect(arg.entityIds).toBeUndefined();
    expect(arg.signalTypes).toBeUndefined();
    expect(arg.dateFrom).toBeUndefined();
  });

  it('floor OFF → доп. base-подъёма (graphHops=0) НЕТ', async () => {
    const { svc, fetchCandidates } = makeService(false);
    await runRetrieval(svc);

    const baseCall = fetchCandidates.mock.calls.find(
      (c) => c[0]?.graphHops === 0 && c[0]?.limit === 30,
    );
    expect(baseCall).toBeUndefined();
  });

  it('temporal-фильтр (bitemporalActiveOnly) → base-подъём ПРОПУЩЕН (не реинъектит superseded)', async () => {
    const { svc, fetchCandidates } = makeService(true);
    await runRetrieval(svc, {
      structuralFilters: {
        dateFrom: null,
        dateTo: null,
        signalTypes: [],
        entityIds: [],
        personIds: [],
        themeBranches: [],
        bitemporalActiveOnly: true,
      },
    });
    const baseCall = fetchCandidates.mock.calls.find(
      (c) => c[0]?.graphHops === 0 && c[0]?.limit === 30,
    );
    expect(baseCall).toBeUndefined();
  });

  it('fail-open: base fetch падает → runRetrieval не бросает, пул из semantic', async () => {
    const { svc } = makeService(true, { baseThrows: true });
    const res = await runRetrieval(svc);
    expect(Array.isArray(res.blockIds)).toBe(true);
    expect(res.blockIds.length).toBeGreaterThan(0);
  });
});
