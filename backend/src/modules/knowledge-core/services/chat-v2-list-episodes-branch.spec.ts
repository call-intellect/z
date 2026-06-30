import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service, type ChatV2Episode, type ChatV2Input } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

function makeService(over?: {
  listEpisodesByActors?: ReturnType<typeof vi.fn>;
  loadContextBlocks?: unknown[];
}): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
  listEpisodesByActors: ReturnType<typeof vi.fn>;
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
    text: 'Нашёл встречи: список.',
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary' as const,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const listEpisodesByActors =
    over?.listEpisodesByActors ?? vi.fn().mockResolvedValue([]);
  const retrieval = {
    fetchCandidates: vi.fn(),
    selectTopThemes: vi.fn().mockResolvedValue([]),
    poolByThemes: vi.fn().mockResolvedValue([]),
    runStructuralAggregate: vi.fn().mockResolvedValue([]),
    listEpisodesByActors,
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

  const contextBlocks = over?.loadContextBlocks ?? [
    {
      id: 'b-1',
      name: 'seed',
      signalType: 'fact',
      trustedAnswer: 'Утверждение',
      dataClass: 'public' as const,
      primaryMeetingEvidence: null,
    },
  ];
  const internal = svc as unknown as {
    loadContextBlocks: (...a: unknown[]) => Promise<unknown[]>;
    buildReasoningChains: (...a: unknown[]) => Promise<unknown[]>;
    loadContradictingBlocks: (...a: unknown[]) => Promise<unknown[]>;
    buildScopeAddon: (...a: unknown[]) => Promise<string>;
  };
  vi.spyOn(internal, 'loadContextBlocks').mockResolvedValue(contextBlocks);
  vi.spyOn(internal, 'buildReasoningChains').mockResolvedValue([]);
  vi.spyOn(internal, 'loadContradictingBlocks').mockResolvedValue([]);
  vi.spyOn(internal, 'buildScopeAddon').mockResolvedValue('');

  return { svc, llmCall, listEpisodesByActors };
}

function userMessageOf(llmCall: ReturnType<typeof vi.fn>): string {
  const call = llmCall.mock.calls[0];
  const arg = call?.[0] as { userMessage?: string } | undefined;
  return arg?.userMessage ?? '';
}

const EPISODES: ChatV2Episode[] = [
  {
    id: 'ep-1',
    title: 'Планёрка по запуску',
    occurredAt: new Date('2026-06-20T10:00:00Z'),
    kind: 'meeting',
    rawEventId: 're-1',
  },
  {
    id: 'ep-2',
    title: 'Разбор бюджета',
    occurredAt: new Date('2026-06-05T10:00:00Z'),
    kind: 'meeting',
    rawEventId: 're-2',
  },
];

const listInput: ChatV2Input = {
  tenantId: 'org-1',
  userId: 'user-1',
  scope: 'org',
  scopeId: null,
  query: 'все встречи с Ивановым',
  precomputedBlockIds: ['b-1'],
  queryClass: 'list',
  queryClassConfidence: 0.9,
  structuralFilters: {
    dateFrom: null,
    dateTo: null,
    signalTypes: [],
    entityIds: [],
    personIds: ['p-ivanov'],
    themeBranches: [],
    bitemporalActiveOnly: false,
  },
};

describe('ChatV2Service — answerKind деривация (Ф10 R12)', () => {
  it('class=list → answerKind=list, episodes непуст', async () => {
    const { svc } = makeService({
      listEpisodesByActors: vi.fn().mockResolvedValue(EPISODES),
    });
    const out = await svc.ask({ ...listInput });
    expect(out.answerKind).toBe('list');
    expect(out.episodes).toBeDefined();
    expect(out.episodes!.length).toBeGreaterThanOrEqual(1);
    expect(out.episodes![0]!.id).toBe('ep-1');
    expect(out.episodes![0]!.rawEventId).toBe('re-1');
  });

  it('class=temporal → answerKind=recap', async () => {
    const { svc } = makeService();
    const out = await svc.ask({ ...listInput, queryClass: 'temporal' });
    expect(out.answerKind).toBe('recap');
    expect(out.episodes).toBeUndefined();
  });

  it('class=overview → answerKind=overview', async () => {
    const { svc } = makeService();
    const out = await svc.ask({ ...listInput, queryClass: 'overview' });
    expect(out.answerKind).toBe('overview');
    expect(out.episodes).toBeUndefined();
  });

  it('class=fact → answerKind=prose, episodes пуст', async () => {
    const { svc } = makeService();
    const out = await svc.ask({ ...listInput, queryClass: 'fact' });
    expect(out.answerKind).toBe('prose');
    expect(out.episodes).toBeUndefined();
  });

  it('class=topic → answerKind=prose', async () => {
    const { svc } = makeService();
    const out = await svc.ask({ ...listInput, queryClass: 'topic' });
    expect(out.answerKind).toBe('prose');
  });

  it('queryClass не задан → answerKind=prose', async () => {
    const { svc } = makeService();
    const out = await svc.ask({
      ...listInput,
      queryClass: undefined,
      queryClassConfidence: undefined,
    });
    expect(out.answerKind).toBe('prose');
  });
});

describe('ChatV2Service — list-ветка контекста эпизодов (мост К1, Ф10)', () => {
  it('class=list + эпизоды → секция «Источники» с маркером [ИСТОЧНИК:], а не только блоки', async () => {
    const listEpisodesByActors = vi.fn().mockResolvedValue(EPISODES);
    const { svc, llmCall } = makeService({ listEpisodesByActors });

    await svc.ask({ ...listInput });

    expect(listEpisodesByActors).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1', personIds: ['p-ivanov'] }),
    );
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).toContain('Источники (встречи/документы/чаты):');
    expect(userMsg).toContain('[ИСТОЧНИК:re-1] Планёрка по запуску');
    expect(userMsg).toContain('[ИСТОЧНИК:re-2] Разбор бюджета');
    expect(userMsg).toContain('встреча');
  });

  it('class=list без personIds/entityIds → секции «Источники» нет (семантика)', async () => {
    const listEpisodesByActors = vi.fn().mockResolvedValue([]);
    const { svc, llmCall } = makeService({ listEpisodesByActors });

    const out = await svc.ask({
      ...listInput,
      structuralFilters: {
        dateFrom: null,
        dateTo: null,
        signalTypes: [],
        entityIds: [],
        personIds: [],
        themeBranches: [],
        bitemporalActiveOnly: false,
      },
    });

    expect(listEpisodesByActors).not.toHaveBeenCalled();
    expect(out.episodes).toBeUndefined();
    expect(userMessageOf(llmCall)).not.toContain('Источники (встречи');
  });

  it('падение listEpisodesByActors НЕ валит ответ (семантика отвечает)', async () => {
    const listEpisodesByActors = vi.fn().mockRejectedValue(new Error('db down'));
    const { svc, llmCall } = makeService({ listEpisodesByActors });

    const out = await svc.ask({ ...listInput });

    expect(out.message).toBe('Нашёл встречи: список.');
    expect(out.episodes).toBeUndefined();
    expect(userMessageOf(llmCall)).not.toContain('Источники (встречи');
  });

  it('class=fact → listEpisodesByActors НЕ зовётся (регресс-guard)', async () => {
    const listEpisodesByActors = vi.fn().mockResolvedValue(EPISODES);
    const { svc, llmCall } = makeService({ listEpisodesByActors });

    await svc.ask({ ...listInput, queryClass: 'fact' });

    expect(listEpisodesByActors).not.toHaveBeenCalled();
    expect(userMessageOf(llmCall)).not.toContain('Источники (встречи');
  });

  it('list с эпизодами но без блоков → синтез по эпизодам (не заглушка)', async () => {
    const listEpisodesByActors = vi.fn().mockResolvedValue(EPISODES);
    const { svc, llmCall } = makeService({
      listEpisodesByActors,
      loadContextBlocks: [],
    });

    const out = await svc.ask({ ...listInput });

    expect(out.modelUsed).not.toBe('none');
    expect(out.answerKind).toBe('list');
    expect(out.episodes).toBeDefined();
    expect(userMessageOf(llmCall)).toContain('Источники (встречи/документы/чаты):');
  });
});
