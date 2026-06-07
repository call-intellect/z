/**
 * KC-Temporal W3.3 (2026-05-25) — unit-тесты counter-evidence в Chat-v2.
 *
 * Покрытие:
 *   1. Если у блока есть active contradicts-link — другой конец подмешивается
 *      в LLM-контекст с тегом `[CONTRADICTING BLOCK]`, метрика
 *      `observeChatV2ContradictingBlocksInContext` инкрементируется
 *      положительным числом.
 *   2. Если нет contradicts-link — counter-evidence пусто, метрика observe(0).
 *
 * Тестируем через `loadContradictingBlocks` напрямую (private) — для этого
 * используем `as any` cast. Это допустимо: метод проверяется в полной
 * intent unit-режим, без NestJS setup.
 */
import { describe, expect, it, vi } from 'vitest';


import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service } from './chat-v2.service';

function makeService(args: {
  contradictsLinks?: Array<{
    fromBlockId: string;
    toBlockId: string;
    confidence: number;
  }>;
  contradictsBlockRows?: Array<{
    id: string;
    name: string;
    signalType: string;
    trustedAnswer: string;
  }>;
}): {
  svc: ChatV2Service;
  metrics: {
    observeChatV2ContradictingBlocksInContext: ReturnType<typeof vi.fn>;
    incChatV2ReasoningChainsAttached: ReturnType<typeof vi.fn>;
  };
  prisma: {
    ideaBlockLinkFindMany: ReturnType<typeof vi.fn>;
    ideaBlockFindMany: ReturnType<typeof vi.fn>;
  };
} {
  const ideaBlockLinkFindMany = vi.fn(
    async () => args.contradictsLinks ?? [],
  );
  const ideaBlockFindMany = vi.fn(async () => args.contradictsBlockRows ?? []);

  const prisma = {
    ideaBlockLink: { findMany: ideaBlockLinkFindMany },
    ideaBlock: { findMany: ideaBlockFindMany },
  } as unknown as PrismaService;

  const cfg = {
    knowledgeCore: { chatV2TopBlocks: 16, chatV2GraphHops: 1 },
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' as const },
  } as unknown as TypedConfigService;

  const observeChatV2ContradictingBlocksInContext = vi.fn();
  const incChatV2ReasoningChainsAttached = vi.fn();
  const metrics = {
    observeChatV2ContradictingBlocksInContext,
    incChatV2ReasoningChainsAttached,
  } as unknown as BusinessMetricsService;

  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const retrieval = {
    fetchCandidates: vi.fn(),
  } as unknown as ChatV2RetrievalService;

  // Ф4 — accessResolver обязателен в конструкторе. Здесь null-ctx гейт не
  // используется (loadContradictingBlocks зовётся с accessCtx=null), поэтому
  // достаточно stub без реальных методов.
  const accessResolver = {
    partitionBlockIdsByAccess: vi.fn(),
  } as unknown as import('../../rbac/knowledge-access-resolver.service').KnowledgeAccessResolver;

  const svc = new ChatV2Service(
    prisma,
    cfg,
    llm,
    retrieval,
    metrics,
    accessResolver,
    // dataClassPolicy: undefined (optional)
    undefined,
    // reasoningChain: undefined (optional) — отдельный тест W3.2
    undefined,
  );

  return {
    svc,
    metrics: {
      observeChatV2ContradictingBlocksInContext,
      incChatV2ReasoningChainsAttached,
    },
    prisma: { ideaBlockLinkFindMany, ideaBlockFindMany },
  };
}

describe('ChatV2Service — counter-evidence (W3.3)', () => {
  it('подмешивает contradicting блоки и observe-ит метрику с count>0', async () => {
    const { svc, metrics, prisma } = makeService({
      // seed-блоки: b-seed-1, b-seed-2. contradicts links: b-seed-1 ↔ b-ext-1.
      contradictsLinks: [
        { fromBlockId: 'b-seed-1', toBlockId: 'b-ext-1', confidence: 0.85 },
      ],
      contradictsBlockRows: [
        {
          id: 'b-ext-1',
          name: 'ext',
          signalType: 'fact',
          trustedAnswer: 'Противоположный факт',
        },
      ],
    });

    // Контекст-блоки (типа того, что вернул бы loadContextBlocks).
    const contextBlocks = [
      {
        id: 'b-seed-1',
        name: 'seed 1',
        signalType: 'fact',
        trustedAnswer: 'Утверждение A',
        dataClass: 'public' as const,
        primaryMeetingEvidence: null,
      },
      {
        id: 'b-seed-2',
        name: 'seed 2',
        signalType: 'fact',
        trustedAnswer: 'Утверждение B',
        dataClass: 'public' as const,
        primaryMeetingEvidence: null,
      },
    ];

    // Вызываем private метод через cast.
    const result = await (
      svc as unknown as {
        loadContradictingBlocks: (
          t: string,
          b: typeof contextBlocks,
          accessCtx: null,
          enforcement: 'off',
        ) => Promise<unknown[]>;
      }
    ).loadContradictingBlocks('org-1', contextBlocks, null, 'off');

    expect(prisma.ideaBlockLinkFindMany).toHaveBeenCalledTimes(1);
    const linkCall = prisma.ideaBlockLinkFindMany.mock.calls[0]?.[0];
    expect(linkCall?.where?.relationType).toBe('contradicts');
    expect(linkCall?.where?.status).toBe('active');

    expect(result).toHaveLength(1);
    expect((result[0] as { id: string }).id).toBe('b-ext-1');
    expect(
      (result[0] as { contradictsBlockId: string }).contradictsBlockId,
    ).toBe('b-seed-1');
    expect(
      metrics.observeChatV2ContradictingBlocksInContext,
    ).toHaveBeenCalledWith(1);
  });

  it('без contradicts-link: возвращает [] и observe(0)', async () => {
    const { svc, metrics } = makeService({
      contradictsLinks: [],
      contradictsBlockRows: [],
    });

    const contextBlocks = [
      {
        id: 'b1',
        name: 'b1',
        signalType: 'fact',
        trustedAnswer: 'A',
        dataClass: 'public' as const,
        primaryMeetingEvidence: null,
      },
    ];

    const result = await (
      svc as unknown as {
        loadContradictingBlocks: (
          t: string,
          b: typeof contextBlocks,
          accessCtx: null,
          enforcement: 'off',
        ) => Promise<unknown[]>;
      }
    ).loadContradictingBlocks('org-1', contextBlocks, null, 'off');

    expect(result).toEqual([]);
    expect(
      metrics.observeChatV2ContradictingBlocksInContext,
    ).toHaveBeenCalledWith(0);
  });
});
