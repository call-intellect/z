/**
 * §4 Ф3 (2026-06-11) — chat-v2 пробрасывает СВОЙ per-call timeout синтеза
 * (knowledge.chatV2SynthesisTimeoutMs) в LlmRouter.call, независимо от
 * глобального LLM_ROUTER_DISPATCH_TIMEOUT_MS. Это защищает длинный ответ
 * AI-чата от обрыва на глобальном hard-timeout'е.
 *
 * Тест изолирует именно синтез-вызов: private retrieval/prisma-методы
 * заспаены (stub), чтобы `ask` детерминированно дошёл до `this.llm.call`
 * без сети/БД. Проверяем, что объект вызова содержит
 * `{ taskType: 'chat-v2', timeoutMs: <значение из cfg> }`.
 *
 * ТЗ: plans/tz/2026-06-11-cabinet-leftovers-ui-probe-chat.md
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import type { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import { ChatV2Service, type ChatV2Input } from './chat-v2.service';

const SYNTH_TIMEOUT_MS = 90_000;

function makeService(): {
  svc: ChatV2Service;
  llmCall: ReturnType<typeof vi.fn>;
} {
  // ТЗ 2026-06-15 — ask() читает CompanyProfile для хвоста «О компании».
  // Здесь профиля нет (findUnique→null) → секция опускается.
  const prisma = {
    companyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  const cfg = {
    knowledgeCore: {
      chatV2TopBlocks: 16,
      chatV2GraphHops: 1,
      chatV2SynthesisTimeoutMs: SYNTH_TIMEOUT_MS,
    },
    knowledgeAccess: { enforcement: 'off' as const },
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' as const },
  } as unknown as TypedConfigService;

  const metrics = {
    incQueryPlanRetrievalFiltered: vi.fn(),
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

  const svc = new ChatV2Service(
    prisma,
    cfg,
    llm,
    retrieval,
    metrics,
    accessResolver,
    undefined,
    undefined,
  );

  // Изолируем синтез: заглушаем retrieval/prisma-зависимые private-методы,
  // чтобы `ask` детерминированно дошёл до `this.llm.call` без сети/БД.
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

describe('ChatV2Service — synthesis per-call timeout (§4 Ф3)', () => {
  it('передаёт chatV2SynthesisTimeoutMs из cfg в llm.call как timeoutMs', async () => {
    const { svc, llmCall } = makeService();

    const input: ChatV2Input = {
      tenantId: 'org-1',
      userId: 'user-1',
      scope: 'org',
      scopeId: null,
      query: 'Что решили по бюджету?',
      precomputedBlockIds: ['b-1'],
    };

    await svc.ask(input);

    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'chat-v2',
        timeoutMs: SYNTH_TIMEOUT_MS,
      }),
    );
  });
});
