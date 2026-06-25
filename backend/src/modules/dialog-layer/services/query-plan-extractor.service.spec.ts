import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import {
  type QueryPlanExtractInput,
  QueryPlanExtractorService,
} from './query-plan-extractor.service';

function makeCfg(): TypedConfigService {
  return {
    aiFeatures: { promptInjectionGuardEnabled: true },
  } as unknown as TypedConfigService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incPromptInjectionAttempt: vi.fn(),
    incPromptInvalidResponse: vi.fn(),
  } as unknown as BusinessMetricsService;
}

const TODAY = '2026-06-10T09:00:00Z';

function makeInput(overrides: Partial<QueryPlanExtractInput> = {}): QueryPlanExtractInput {
  return {
    tenantId: 'org-1',
    userId: 'user-1',
    questions: [
      'Что решали по маркетингу на этой неделе?',
      'Какие решения принимал отдел маркетинга на этой неделе?',
      'Итоги обсуждений маркетинга за эту неделю — какие решения?',
    ],
    todayIso: TODAY,
    orgTimezone: null,
    conversationId: null,
    ...overrides,
  };
}

function llmResult(text: string) {
  return {
    text,
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durationMs: 1,
  };
}

function makeService(callImpl: () => unknown) {
  const llm = { call: vi.fn(callImpl) } as unknown as LlmRouterService;
  const prisma = {
    person: { findFirst: vi.fn().mockResolvedValue({ id: 'person-1' }) },
    entity: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  const service = new QueryPlanExtractorService(llm, prisma, makeCfg(), makeMetrics());
  return { service, llm, prisma };
}

describe('QueryPlanExtractorService', () => {
  it('применяет план при валидном JSON и высокой уверенности', async () => {
    const json = JSON.stringify({
      periodExpr: 'this_week',
      periodDays: null,
      signalTypes: ['decision'],
      themeBranches: ['marketing'],
      entityHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
      confidence: 0.9,
    });
    const { service, llm } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(true);
    expect(res.filters.signalTypes).toEqual(['decision']);
    expect(res.filters.themeBranches).toEqual(['marketing']);
    expect(res.filters.dateFrom).toBeInstanceOf(Date);
    expect(res.filters.dateTo).toBeInstanceOf(Date);
    expect(res.filters.dateFrom?.toISOString()).toBe('2026-06-07T21:00:00.000Z');
    expect(llm.call).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'dialog-extract-plan' }),
    );
  });

  it('fail-open при невалидном JSON (applied=false, пустой план)', async () => {
    const { service } = makeService(() => Promise.resolve(llmResult('not json')));

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(false);
    expect(res.filters.dateFrom).toBeNull();
    expect(res.filters.dateTo).toBeNull();
    expect(res.filters.signalTypes).toEqual([]);
    expect(res.filters.themeBranches).toEqual([]);
    expect(res.filters.entityHints).toEqual([]);
    expect(res.filters.personScope).toBe(false);
  });

  it('fail-open когда llm.call бросает исключение', async () => {
    const { service } = makeService(() => Promise.reject(new Error('all providers failed')));

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(false);
    expect(res.confidence).toBe(0);
    expect(res.filters.signalTypes).toEqual([]);
  });

  it('не применяет план при низкой уверенности (confidence=0.4)', async () => {
    const json = JSON.stringify({
      periodExpr: 'this_week',
      periodDays: null,
      signalTypes: ['decision'],
      themeBranches: ['marketing'],
      entityHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
      confidence: 0.4,
    });
    const { service } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(false);
    expect(res.confidence).toBeCloseTo(0.4);
    expect(res.filters.signalTypes).toEqual([]);
    expect(res.filters.dateFrom).toBeNull();
  });

  it('санитизирует невалидные signalTypes', async () => {
    const json = JSON.stringify({
      periodExpr: 'none',
      periodDays: null,
      signalTypes: ['decision', 'bogus_type'],
      themeBranches: [],
      entityHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
      confidence: 0.9,
    });
    const { service } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(true);
    expect(res.filters.signalTypes).toEqual(['decision']);
  });

  it('activeNow round-trips: применяет план только из activeNow без других осей', async () => {
    const json = JSON.stringify({
      periodExpr: 'none',
      periodDays: null,
      signalTypes: [],
      themeBranches: [],
      entityHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: true,
      confidence: 0.9,
    });
    const { service } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(true);
    expect(res.filters.activeNow).toBe(true);
  });

  it('resolveSelfPersonId возвращает id без мутации', async () => {
    const { service, prisma } = makeService(() => Promise.resolve(llmResult('{}')));

    const id = await service.resolveSelfPersonId('org-1', 'user-1');

    expect(id).toBe('person-1');
    expect(prisma.person.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'org-1', userId: 'user-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('resolveSelfPersonId возвращает null когда Person не найден', async () => {
    const llm = { call: vi.fn() } as unknown as LlmRouterService;
    const prisma = {
      person: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new QueryPlanExtractorService(llm, prisma, makeCfg(), makeMetrics());

    const id = await service.resolveSelfPersonId('org-1', 'user-x');
    expect(id).toBeNull();
  });
});

describe('QueryPlanExtractorService.understand — слитый модуль (Ф4b)', () => {
  function understandInput() {
    return {
      tenantId: 'org-1',
      userId: 'user-1',
      question: 'а сколько это стоит?',
      summary: 'Про продукт Маяк.',
      history: [{ role: 'user' as const, content: 'Что по Маяк?' }],
      todayIso: TODAY,
      orgTimezone: null,
      conversationId: 'conv-1',
    };
  }

  it('валидный объединённый ответ → 3 деду́пнутых запроса + применённый план', async () => {
    const json = JSON.stringify({
      queries: [
        'Сколько стоит продукт Маяк?',
        'Из чего складывается цена Маяк?',
        'Есть ли скидки по Маяк?',
      ],
      plan: {
        periodExpr: 'this_week',
        periodDays: null,
        signalTypes: ['decision'],
        themeBranches: ['sales'],
        entityHints: [],
        personScope: false,
        aggregation: true,
        needsAction: false,
        activeNow: false,
      },
      confidence: 0.9,
    });
    const { service, llm } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.understand(understandInput());

    expect(res.queries).toEqual([
      'а сколько это стоит?',
      'Сколько стоит продукт Маяк?',
      'Из чего складывается цена Маяк?',
    ]);
    expect(res.queryPlan.applied).toBe(true);
    expect(res.queryPlan.filters.signalTypes).toEqual(['decision']);
    expect(res.queryPlan.filters.themeBranches).toEqual(['sales']);
    expect(res.queryPlan.filters.aggregation).toBe(true);
    expect(res.queryPlan.filters.dateFrom).toBeInstanceOf(Date);
    expect(llm.call).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'dialog-understand' }),
    );
  });

  it('дедуп: вопрос совпал с переформулировкой (без учёта регистра) — без дублей', async () => {
    const json = JSON.stringify({
      queries: ['А Сколько Это Стоит?', 'Сколько стоит продукт Маяк?'],
      plan: {
        periodExpr: 'none',
        periodDays: null,
        signalTypes: [],
        themeBranches: [],
        entityHints: [],
        personScope: false,
        aggregation: false,
        needsAction: false,
        activeNow: false,
      },
      confidence: 0.3,
    });
    const { service } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.understand(understandInput());

    expect(res.queries).toEqual(['а сколько это стоит?', 'Сколько стоит продукт Маяк?']);
  });

  it('малформенный ответ → fail-open: queries=[question], план не применён', async () => {
    const { service } = makeService(() => Promise.resolve(llmResult('not json at all')));

    const res = await service.understand(understandInput());

    expect(res.queries).toEqual(['а сколько это стоит?']);
    expect(res.queryPlan.applied).toBe(false);
    expect(res.queryPlan.filters.signalTypes).toEqual([]);
    expect(res.queryPlan.filters.dateFrom).toBeNull();
  });

  it('llm.call бросает → fail-open', async () => {
    const { service } = makeService(() => Promise.reject(new Error('all providers failed')));

    const res = await service.understand(understandInput());

    expect(res.queries).toEqual(['а сколько это стоит?']);
    expect(res.queryPlan.applied).toBe(false);
  });

  it('низкая уверенность плана (0.4) → план НЕ применён, но queries отдаются', async () => {
    const json = JSON.stringify({
      queries: ['Сколько стоит Маяк?'],
      plan: {
        periodExpr: 'this_week',
        periodDays: null,
        signalTypes: ['decision'],
        themeBranches: [],
        entityHints: [],
        personScope: false,
        aggregation: false,
        needsAction: false,
        activeNow: false,
      },
      confidence: 0.4,
    });
    const { service } = makeService(() => Promise.resolve(llmResult(json)));

    const res = await service.understand(understandInput());

    expect(res.queries).toEqual(['а сколько это стоит?', 'Сколько стоит Маяк?']);
    expect(res.queryPlan.applied).toBe(false);
    expect(res.queryPlan.filters.signalTypes).toEqual([]);
  });
});
