import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import type { ChatV2TableContextService } from './chat-v2-table-context.service';
import { ChatV2Service, type ChatV2Input } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

function makeService(tableContext?: ChatV2TableContextService): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
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
    text: 'Готовый ответ AI-чата.',
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary' as const,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const retrieval = {
    fetchCandidates: vi.fn(),
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
    undefined,
    undefined,
    tableContext,
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

  return { svc, llmCall };
}

function userMessageOf(llmCall: ReturnType<typeof vi.fn>): string {
  const call = llmCall.mock.calls[0];
  const arg = call?.[0] as { userMessage?: string } | undefined;
  return arg?.userMessage ?? '';
}

const baseInput: ChatV2Input = {
  tenantId: 'org-1',
  userId: 'user-1',
  scope: 'org',
  scopeId: null,
  query: 'Сколько клиентов из Москвы?',
  precomputedBlockIds: ['b-1'],
  queries: ['Сколько клиентов из Москвы?'],
};

describe('ChatV2Service — табличная ветка (ЧАСТЬ B §7)', () => {
  it('падение ветки таблиц НЕ валит ответ (graceful, граф отвечает)', async () => {
    const tableContext = {
      fetchTableContext: vi.fn().mockRejectedValue(new Error('tables down')),
    } as unknown as ChatV2TableContextService;
    const { svc, llmCall } = makeService(tableContext);

    const out = await svc.ask({ ...baseInput });

    expect(out.message).toBe('Готовый ответ AI-чата.');
    expect(llmCall).toHaveBeenCalledTimes(1);
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Данные из таблиц');
  });

  it('строки таблиц доходят до buildUserMessage (блок «Данные из таблиц»)', async () => {
    const tableContext = {
      fetchTableContext: vi
        .fn()
        .mockResolvedValue([{ tableName: 'Клиенты', cells: 'Город=Москва; Сумма=100000' }]),
    } as unknown as ChatV2TableContextService;
    const { svc, llmCall } = makeService(tableContext);

    await svc.ask({ ...baseInput });

    const userMsg = userMessageOf(llmCall);
    expect(userMsg).toContain('Данные из таблиц');
    expect(userMsg).toContain('[ТАБЛИЦА: Клиенты] Город=Москва; Сумма=100000');
  });

  it('без сервиса tableContext (undefined) ask не падает, секции таблиц нет', async () => {
    const { svc, llmCall } = makeService(undefined);

    const out = await svc.ask({ ...baseInput });

    expect(out.message).toBe('Готовый ответ AI-чата.');
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Данные из таблиц');
  });

  it('без обогащённого понимания (нет queries/entityIds/hints) ветка не вызывается', async () => {
    const fetchTableContext = vi.fn().mockResolvedValue([]);
    const tableContext = { fetchTableContext } as unknown as ChatV2TableContextService;
    const { svc } = makeService(tableContext);

    await svc.ask({
      tenantId: 'org-1',
      userId: 'user-1',
      scope: 'org',
      scopeId: null,
      query: 'просто вопрос',
      precomputedBlockIds: ['b-1'],
    });

    expect(fetchTableContext).not.toHaveBeenCalled();
  });

  it('табличная ветка запускается с обогащённым пониманием (queries/entityIds/aggregation)', async () => {
    const fetchTableContext = vi.fn().mockResolvedValue([]);
    const tableContext = { fetchTableContext } as unknown as ChatV2TableContextService;
    const { svc } = makeService(tableContext);

    await svc.ask({
      ...baseInput,
      tableEntityIds: ['e-1'],
      tableEntityHints: ['Москва'],
      tableAggregation: true,
    });

    expect(fetchTableContext).toHaveBeenCalledTimes(1);
    expect(fetchTableContext).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        entityIds: ['e-1'],
        entityHints: ['Москва'],
        aggregation: true,
      }),
    );
  });
});
