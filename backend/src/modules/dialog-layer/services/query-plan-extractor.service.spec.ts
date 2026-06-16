import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import {
  type QueryPlanExtractInput,
  QueryPlanExtractorService,
} from './query-plan-extractor.service';

/**
 * Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0) — spec
 * QueryPlanExtractorService.
 */

const TODAY = '2026-06-10T09:00:00Z';

function makeInput(
  overrides: Partial<QueryPlanExtractInput> = {},
): QueryPlanExtractInput {
  return {
    tenantId: 'org-1',
    userId: 'user-1',
    // ТЗ 2026-06-14: вход — 3 самодостаточных формулировки одного запроса.
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

/** Минимальный LlmCallResult-подобный объект. */
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
  } as unknown as PrismaService;
  const service = new QueryPlanExtractorService(llm, prisma);
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
    const { service, llm } = makeService(() =>
      Promise.resolve(llmResult(json)),
    );

    const res = await service.extract(makeInput());

    expect(res.applied).toBe(true);
    expect(res.filters.signalTypes).toEqual(['decision']);
    expect(res.filters.themeBranches).toEqual(['marketing']);
    expect(res.filters.dateFrom).toBeInstanceOf(Date);
    expect(res.filters.dateTo).toBeInstanceOf(Date);
    // this_week @ today=2026-06-10 (МСК) → Пн 2026-06-08 00:00 МСК.
    expect(res.filters.dateFrom?.toISOString()).toBe(
      '2026-06-07T21:00:00.000Z',
    );
    expect(llm.call).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'dialog-extract-plan' }),
    );
  });

  it('fail-open при невалидном JSON (applied=false, пустой план)', async () => {
    const { service } = makeService(() =>
      Promise.resolve(llmResult('not json')),
    );

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
    const { service } = makeService(() =>
      Promise.reject(new Error('all providers failed')),
    );

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
    // confidence сохраняется для наблюдаемости.
    expect(res.confidence).toBeCloseTo(0.4);
    // но фильтры обнулены (downstream ничего случайно не отфильтрует).
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

    // activeNow=true сам по себе делает план применимым (hasAnyFilter).
    expect(res.applied).toBe(true);
    expect(res.filters.activeNow).toBe(true);
  });

  it('resolveSelfPersonId возвращает id без мутации', async () => {
    const { service, prisma } = makeService(() =>
      Promise.resolve(llmResult('{}')),
    );

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
    const service = new QueryPlanExtractorService(llm, prisma);

    const id = await service.resolveSelfPersonId('org-1', 'user-x');
    expect(id).toBeNull();
  });
});
