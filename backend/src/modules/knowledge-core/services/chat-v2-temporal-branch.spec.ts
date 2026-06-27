import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import {
  ChatV2Service,
  extractRecapNarrative,
  monthKeysBetween,
  type ChatV2Input,
} from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

function makeService(prismaTemporal?: {
  valueRecapFindMany?: ReturnType<typeof vi.fn>;
  weeklyDigestFindMany?: ReturnType<typeof vi.fn>;
}): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
  valueRecapFindMany: ReturnType<typeof vi.fn>;
  weeklyDigestFindMany: ReturnType<typeof vi.fn>;
} {
  const valueRecapFindMany = prismaTemporal?.valueRecapFindMany ?? vi.fn().mockResolvedValue([]);
  const weeklyDigestFindMany =
    prismaTemporal?.weeklyDigestFindMany ?? vi.fn().mockResolvedValue([]);

  const prisma = {
    companyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    valueRecapSnapshot: { findMany: valueRecapFindMany },
    weeklyOperationsDigest: { findMany: weeklyDigestFindMany },
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

  return { svc, llmCall, valueRecapFindMany, weeklyDigestFindMany };
}

function userMessageOf(llmCall: ReturnType<typeof vi.fn>): string {
  const call = llmCall.mock.calls[0];
  const arg = call?.[0] as { userMessage?: string } | undefined;
  return arg?.userMessage ?? '';
}

const temporalInput: ChatV2Input = {
  tenantId: 'org-1',
  userId: 'user-1',
  scope: 'org',
  scopeId: null,
  query: 'Какие итоги за прошлый месяц?',
  precomputedBlockIds: ['b-1'],
  queryClass: 'temporal',
  queryClassConfidence: 0.9,
  structuralFilters: {
    dateFrom: new Date('2026-05-01T00:00:00.000Z'),
    dateTo: new Date('2026-05-31T23:59:59.999Z'),
    signalTypes: [],
    entityIds: [],
    personIds: [],
    themeBranches: [],
    bitemporalActiveOnly: false,
  } as unknown as ChatV2Input['structuralFilters'],
};

describe('ChatV2Service — temporal-ветка (мост К3, Ф5)', () => {
  it('class=temporal + ValueRecapSnapshot за период → markdown с маркером из payloadJson', async () => {
    const valueRecapFindMany = vi.fn().mockResolvedValue([
      {
        periodYm: '2026-05',
        payloadJson: { narrative: 'МАЯ-СВЁРТКА: команда наработала много.' },
      },
    ]);
    const { svc, llmCall, valueRecapFindMany: vrSpy } = makeService({ valueRecapFindMany });

    await svc.ask({ ...temporalInput });

    expect(vrSpy).toHaveBeenCalledTimes(1);
    expect(vrSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'org-1',
          periodYm: { in: ['2026-05'] },
        }),
      }),
    );
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).toContain('Итоги периода');
    expect(userMsg).toContain('[ИТОГ ПЕРИОДА: месяц 2026-05]');
    expect(userMsg).toContain('МАЯ-СВЁРТКА: команда наработала много.');
  });

  it('class=temporal + WeeklyOperationsDigest за период → markdown недели', async () => {
    const weeklyDigestFindMany = vi.fn().mockResolvedValue([
      {
        weekStart: '2026-05-04',
        weekEnd: '2026-05-10',
        bodyMarkdown: 'НЕДЕЛЬНАЯ-СВЁРТКА: настроение зелёное.',
      },
    ]);
    const { svc, llmCall } = makeService({ weeklyDigestFindMany });

    await svc.ask({ ...temporalInput });

    const userMsg = userMessageOf(llmCall);
    expect(userMsg).toContain('[ИТОГ ПЕРИОДА: неделя 2026-05-04–2026-05-10]');
    expect(userMsg).toContain('НЕДЕЛЬНАЯ-СВЁРТКА: настроение зелёное.');
  });

  it('нет свёрток за период → секции «Итоги периода» нет', async () => {
    const { svc, llmCall } = makeService();

    const out = await svc.ask({ ...temporalInput });

    expect(out.message).toBe('Готовый ответ AI-чата.');
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Итоги периода');
  });

  it('класс НЕ temporal → ветка не читает digest/recap (0 запросов)', async () => {
    const { svc, valueRecapFindMany, weeklyDigestFindMany } = makeService();

    await svc.ask({
      ...temporalInput,
      queryClass: 'fact',
    });

    expect(valueRecapFindMany).not.toHaveBeenCalled();
    expect(weeklyDigestFindMany).not.toHaveBeenCalled();
  });

  it('temporal без резолвнутого периода → ветка не читает digest/recap', async () => {
    const { svc, valueRecapFindMany, weeklyDigestFindMany } = makeService();

    await svc.ask({
      tenantId: 'org-1',
      userId: 'user-1',
      scope: 'org',
      scopeId: null,
      query: 'итоги?',
      precomputedBlockIds: ['b-1'],
      queryClass: 'temporal',
      queryClassConfidence: 0.9,
    });

    expect(valueRecapFindMany).not.toHaveBeenCalled();
    expect(weeklyDigestFindMany).not.toHaveBeenCalled();
  });

  it('падение чтения свёрток НЕ валит ответ (граф/семантика отвечает)', async () => {
    const valueRecapFindMany = vi.fn().mockRejectedValue(new Error('db down'));
    const { svc, llmCall } = makeService({ valueRecapFindMany });

    const out = await svc.ask({ ...temporalInput });

    expect(out.message).toBe('Готовый ответ AI-чата.');
    const userMsg = userMessageOf(llmCall);
    expect(userMsg).not.toContain('Итоги периода');
  });
});

describe('monthKeysBetween', () => {
  it('один месяц', () => {
    expect(
      monthKeysBetween(
        new Date('2026-05-01T00:00:00.000Z'),
        new Date('2026-05-31T23:59:59.999Z'),
      ),
    ).toEqual(['2026-05']);
  });

  it('несколько месяцев через границу года', () => {
    expect(
      monthKeysBetween(
        new Date('2025-12-15T00:00:00.000Z'),
        new Date('2026-02-10T00:00:00.000Z'),
      ),
    ).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('from > to → пусто', () => {
    expect(
      monthKeysBetween(
        new Date('2026-06-01T00:00:00.000Z'),
        new Date('2026-05-01T00:00:00.000Z'),
      ),
    ).toEqual([]);
  });
});

describe('extractRecapNarrative', () => {
  it('берёт narrative из payload', () => {
    expect(extractRecapNarrative({ narrative: '  итог  ' })).toBe('итог');
  });

  it('пустой narrative → null', () => {
    expect(extractRecapNarrative({ narrative: '   ' })).toBeNull();
  });

  it('не объект / нет поля → null', () => {
    expect(extractRecapNarrative(null)).toBeNull();
    expect(extractRecapNarrative([{ narrative: 'x' }])).toBeNull();
    expect(extractRecapNarrative({ other: 1 })).toBeNull();
  });
});
