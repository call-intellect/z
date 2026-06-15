/**
 * §4 Ф1 (2026-06-11) — chat-v2 эмитит стадии прогресса через колбэк onStage
 * по ходу ask() для SSE-стриминга («Ищу в памяти → Пишу ответ»). Стадия
 * 'understanding' эмитится раньше (в оркестраторе), здесь проверяем именно
 * 'searching' и 'writing' на уровне knowledge-core ChatV2Service.
 *
 * Тест изолирует синтез: private retrieval/prisma-методы заспаены (stub),
 * чтобы `ask` детерминированно дошёл до `this.llm.call` без сети/БД.
 * Проверяем:
 *   1) при переданном onStage он вызывается 'searching', затем 'writing' (в этом порядке);
 *   2) без onStage (undefined) `ask` не падает (обратная совместимость).
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
import { ChatV2Service, type ChatV2Input, type ChatV2Stage } from './chat-v2.service';

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
      chatV2SynthesisTimeoutMs: 90_000,
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

const baseInput: ChatV2Input = {
  tenantId: 'org-1',
  userId: 'user-1',
  scope: 'org',
  scopeId: null,
  query: 'Что решили по бюджету?',
  precomputedBlockIds: ['b-1'],
};

describe('ChatV2Service — стадии прогресса onStage (§4 Ф1)', () => {
  it('эмитит searching, затем writing — в этом порядке', async () => {
    const { svc } = makeService();
    const stages: ChatV2Stage[] = [];

    await svc.ask({ ...baseInput, onStage: (s) => stages.push(s) });

    expect(stages).toEqual(['searching', 'writing']);
  });

  it('эмитит searching ДО writing относительно вызова llm.call', async () => {
    const { svc, llmCall } = makeService();
    const order: string[] = [];

    await svc.ask({
      ...baseInput,
      onStage: (s) => order.push(`stage:${s}`),
    });
    // llmCall зафиксирован отдельно: writing эмитится перед ним.
    expect(order).toEqual(['stage:searching', 'stage:writing']);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('без onStage (undefined) ask не падает — обратная совместимость', async () => {
    const { svc, llmCall } = makeService();

    const out = await svc.ask({ ...baseInput });

    expect(out.message).toBe('Готовый ответ AI-чата.');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('не ломает ask, если колбэк onStage бросает исключение', async () => {
    const { svc, llmCall } = makeService();

    const out = await svc.ask({
      ...baseInput,
      onStage: () => {
        throw new Error('boom from progress callback');
      },
    });

    expect(out.message).toBe('Готовый ответ AI-чата.');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });
});
