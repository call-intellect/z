import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service, type ChatV2Input } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

const CLARIFY_GOLDEN =
  '[[CLARIFY]] В памяти есть несколько разных встреч с Александром:\n' +
  '- Встреча по бюджету от 3 марта: согласовали лимит на квартал [BLOCK:aaa111].\n' +
  '- Встреча по найму от 12 апреля: решили открыть две вакансии [BLOCK:bbb222].\n' +
  '- Встреча по партнёрству от 5 мая: договорились о пилоте [BLOCK:ccc333].\n' +
  'Какую из них вы имеете в виду?';

const NORMAL_GOLDEN = 'Бюджет на квартал согласовали в полном объёме [BLOCK:aaa111].';

function makeService(llmText: string): {
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
    text: llmText,
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
  );

  const blocks = [
    {
      id: 'aaa111',
      name: 'Встреча по бюджету',
      signalType: 'decision',
      trustedAnswer: 'Лимит на квартал согласован',
      dataClass: 'internal' as const,
      primaryMeetingEvidence: {
        meetingId: 'm-1',
        meetingTitle: 'Бюджет Q1',
        startMs: 0,
        endMs: 1000,
        snippet: 'согласовали лимит',
      },
    },
    {
      id: 'bbb222',
      name: 'Встреча по найму',
      signalType: 'decision',
      trustedAnswer: 'Открыть две вакансии',
      dataClass: 'internal' as const,
      primaryMeetingEvidence: {
        meetingId: 'm-2',
        meetingTitle: 'Найм',
        startMs: 0,
        endMs: 1000,
        snippet: 'две вакансии',
      },
    },
    {
      id: 'ccc333',
      name: 'Встреча по партнёрству',
      signalType: 'decision',
      trustedAnswer: 'Договорились о пилоте',
      dataClass: 'internal' as const,
      primaryMeetingEvidence: {
        meetingId: 'm-3',
        meetingTitle: 'Партнёрство',
        startMs: 0,
        endMs: 1000,
        snippet: 'пилот',
      },
    },
  ];

  const internal = svc as unknown as {
    loadContextBlocks: (...a: unknown[]) => Promise<unknown[]>;
    buildReasoningChains: (...a: unknown[]) => Promise<unknown[]>;
    loadContradictingBlocks: (...a: unknown[]) => Promise<unknown[]>;
    buildScopeAddon: (...a: unknown[]) => Promise<string>;
  };
  vi.spyOn(internal, 'loadContextBlocks').mockResolvedValue(blocks);
  vi.spyOn(internal, 'buildReasoningChains').mockResolvedValue([]);
  vi.spyOn(internal, 'loadContradictingBlocks').mockResolvedValue([]);
  vi.spyOn(internal, 'buildScopeAddon').mockResolvedValue('');

  return { svc, llmCall };
}

const baseInput: ChatV2Input = {
  tenantId: 'org-1',
  userId: 'user-1',
  scope: 'org',
  scopeId: null,
  query: 'Что решили на встрече с Александром?',
  precomputedBlockIds: ['aaa111', 'bbb222', 'ccc333'],
};

describe('ChatV2Service.ask — переспрос при нескольких РАЗНЫХ объектах (Ф3)', () => {
  it('синтез вернул [[CLARIFY]] → needsClarification:true, токен вырезан, цитаты [BLOCK] целы', async () => {
    const { svc, llmCall } = makeService(CLARIFY_GOLDEN);

    const out = await svc.ask({ ...baseInput });

    expect(out).toEqual(
      expect.objectContaining({ needsClarification: true }),
    );
    expect(out.message).not.toContain('[[CLARIFY]]');
    expect(out.message).not.toContain('[BLOCK:');
    expect(out.message).toContain('Александром');
    expect(out.message).toContain('Какую из них вы имеете в виду?');
    expect(out.usedBlockIds).toEqual(
      expect.arrayContaining(['aaa111', 'bbb222', 'ccc333']),
    );
    expect(out.citations.length).toBeGreaterThanOrEqual(3);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('обычный ответ синтеза → needsClarification:false, токена нет', async () => {
    const { svc } = makeService(NORMAL_GOLDEN);

    const out = await svc.ask({ ...baseInput });

    expect(out).toEqual(
      expect.objectContaining({ needsClarification: false }),
    );
    expect(out.message).not.toContain('[[CLARIFY]]');
    expect(out.message).not.toContain('[BLOCK:');
    expect(out.message).toContain('Бюджет на квартал согласовали');
    expect(out.usedBlockIds).toEqual(['aaa111']);
  });

  it('[[CLARIFY]] с ведущим переводом строки тоже детектится', async () => {
    const { svc } = makeService(`\n[[CLARIFY]] ${CLARIFY_GOLDEN.slice('[[CLARIFY]] '.length)}`);

    const out = await svc.ask({ ...baseInput });

    expect(out).toEqual(
      expect.objectContaining({ needsClarification: true }),
    );
    expect(out.message).not.toContain('[[CLARIFY]]');
  });

  it('[[CLARIFY]] не в начале текста → НЕ переспрос (только якорь начала)', async () => {
    const { svc } = makeService(
      `Ответ по теме [BLOCK:aaa111]. [[CLARIFY]] это не должно сработать`,
    );

    const out = await svc.ask({ ...baseInput });

    expect(out).toEqual(
      expect.objectContaining({ needsClarification: false }),
    );
    expect(out.message).not.toContain('[[CLARIFY]]');
  });
});
