/**
 * Волна 3 — Б25 [K8] unit-тест темпорального фильтра counter-evidence.
 *
 * До фикса: loadContradictingBlocks подгружал contradicting-блоки без учёта
 * validAt → в темпоральном вопросе «что знали тогда» подмешивались «факты из
 * будущего» (validFrom > X). Фикс: прокинуть validAt и добавить temporal-where
 * (validFrom<=at AND (validUntil IS NULL OR validUntil>at)) в финальный
 * ideaBlock.findMany.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service } from './chat-v2.service';
import type { ProvenanceService } from './provenance.service';

function makeService(): {
  svc: ChatV2Service;
  ideaBlockFindMany: ReturnType<typeof vi.fn>;
} {
  const ideaBlockLinkFindMany = vi.fn(async () => [
    { fromBlockId: 'b-seed-1', toBlockId: 'b-ext-1', confidence: 0.9 },
  ]);
  const ideaBlockFindMany = vi.fn(async () => [
    {
      id: 'b-ext-1',
      name: 'ext',
      signalType: 'fact',
      trustedAnswer: 'Противоположный факт',
    },
  ]);

  const prisma = {
    ideaBlockLink: { findMany: ideaBlockLinkFindMany },
    ideaBlock: { findMany: ideaBlockFindMany },
  } as unknown as PrismaService;

  const cfg = {
    knowledgeCore: { chatV2TopBlocks: 16, chatV2GraphHops: 1 },
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' as const },
  } as unknown as TypedConfigService;

  const metrics = {
    observeChatV2ContradictingBlocksInContext: vi.fn(),
    incChatV2ReasoningChainsAttached: vi.fn(),
  } as unknown as BusinessMetricsService;

  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const retrieval = {
    fetchCandidates: vi.fn(),
  } as unknown as ChatV2RetrievalService;
  const accessResolver = {
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

  return { svc, ideaBlockFindMany };
}

const CTX_BLOCKS = [
  {
    id: 'b-seed-1',
    name: 'seed 1',
    signalType: 'fact',
    trustedAnswer: 'Утверждение A',
    dataClass: 'public' as const,
    primaryMeetingEvidence: null,
  },
];

type LoadFn = (
  t: string,
  b: typeof CTX_BLOCKS,
  accessCtx: null,
  enforcement: 'off',
  validAt?: Date | null,
) => Promise<unknown[]>;

describe('ChatV2Service.loadContradictingBlocks — Б25 [K8] temporal', () => {
  it('validAt задан → temporal-where (validFrom<=at, validUntil null|>at) в findMany', async () => {
    const { svc, ideaBlockFindMany } = makeService();
    const at = new Date('2026-03-01T00:00:00Z');

    await (svc as unknown as { loadContradictingBlocks: LoadFn })
      .loadContradictingBlocks('org-1', CTX_BLOCKS, null, 'off', at);

    expect(ideaBlockFindMany).toHaveBeenCalledTimes(1);
    const where = (
      ideaBlockFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    const and = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
    expect(Array.isArray(and)).toBe(true);
    expect(and).toHaveLength(2);
    // validFrom: null OR validFrom <= at
    expect(and[0]?.OR).toEqual([
      { validFrom: null },
      { validFrom: { lte: at } },
    ]);
    // validUntil: null OR validUntil > at
    expect(and[1]?.OR).toEqual([
      { validUntil: null },
      { validUntil: { gt: at } },
    ]);
  });

  it('validAt НЕ задан → temporal-where отсутствует (byte-identical)', async () => {
    const { svc, ideaBlockFindMany } = makeService();

    await (svc as unknown as { loadContradictingBlocks: LoadFn })
      .loadContradictingBlocks('org-1', CTX_BLOCKS, null, 'off');

    expect(ideaBlockFindMany).toHaveBeenCalledTimes(1);
    const where = (
      ideaBlockFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    expect(where.AND).toBeUndefined();
    expect(where.status).toBe('canonical');
  });
});
