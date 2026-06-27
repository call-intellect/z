import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import {
  type QueryPlanResult,
  QueryPlanExtractorService,
} from './query-plan-extractor.service';

function makeService(args: {
  resolvePersonCandidates: ReturnType<typeof vi.fn>;
  ambiguityDelta?: number;
  entityFindFirst?: ReturnType<typeof vi.fn>;
}) {
  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const prisma = {
    person: { findFirst: vi.fn().mockResolvedValue(null) },
    entity: {
      findFirst:
        args.entityFindFirst ?? vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;
  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: true },
    getDynamic: vi.fn(async (_k: string, _c: unknown, fallback: number) =>
      args.ambiguityDelta ?? fallback,
    ),
  } as unknown as TypedConfigService;
  const metrics = {
    incPromptInjectionAttempt: vi.fn(),
    incPromptInvalidResponse: vi.fn(),
  } as unknown as BusinessMetricsService;
  const entityResolution = {
    resolvePersonCandidates: args.resolvePersonCandidates,
  } as unknown as never;
  const service = new QueryPlanExtractorService(
    llm,
    prisma,
    cfg,
    metrics,
    entityResolution,
  );
  return { service };
}

function listPlan(personHints: string[], entityHints: string[] = []): QueryPlanResult {
  return {
    filters: {
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      themeBranches: [],
      entityHints,
      personHints,
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
    },
    queryClass: 'list',
    queryClassConfidence: 0.9,
    confidence: 0.85,
    applied: true,
    durationSeconds: 0.01,
  };
}

describe('QueryPlanExtractorService.resolveStructuralFiltersWithClarify (Ф4 R14)', () => {
  it('единственный уверенный кандидат → personIds, без уточнения', async () => {
    const { service } = makeService({
      resolvePersonCandidates: vi.fn().mockResolvedValue([
        { personId: 'P1', confidence: 0.7 },
      ]),
    });
    const res = await service.resolveStructuralFiltersWithClarify({
      tenantId: 't1',
      userId: 'u1',
      plan: listPlan(['Иванов']),
    });
    expect(res.clarification).toBeNull();
    expect(res.filters?.personIds).toContain('P1');
  });

  it('≥2 равноуверенных, контекст не сузил → уточняющий вопрос (текст), не список', async () => {
    const { service } = makeService({
      resolvePersonCandidates: vi.fn().mockResolvedValue([
        { personId: 'A1', confidence: 0.62 },
        { personId: 'A2', confidence: 0.6 },
      ]),
    });
    const res = await service.resolveStructuralFiltersWithClarify({
      tenantId: 't1',
      userId: 'u1',
      plan: listPlan(['Александр']),
    });
    expect(res.filters).toBeNull();
    expect(res.clarification).not.toBeNull();
    expect(res.clarification!.question).toContain('Александр');
    expect(res.clarification!.candidatePersonIds).toEqual(['A1', 'A2']);
  });

  it('≥2 кандидата, но дельта большая → берём top1, без уточнения', async () => {
    const { service } = makeService({
      resolvePersonCandidates: vi.fn().mockResolvedValue([
        { personId: 'A1', confidence: 0.9 },
        { personId: 'A2', confidence: 0.4 },
      ]),
    });
    const res = await service.resolveStructuralFiltersWithClarify({
      tenantId: 't1',
      userId: 'u1',
      plan: listPlan(['Александр']),
    });
    expect(res.clarification).toBeNull();
    expect(res.filters?.personIds).toEqual(['A1']);
  });

  it('класс не list → резолв имён не запускается (clarification всегда null)', async () => {
    const resolvePersonCandidates = vi.fn();
    const { service } = makeService({ resolvePersonCandidates });
    const plan = listPlan(['Александр']);
    plan.queryClass = 'topic';
    plan.filters.signalTypes = ['decision'];
    const res = await service.resolveStructuralFiltersWithClarify({
      tenantId: 't1',
      userId: 'u1',
      plan,
    });
    expect(res.clarification).toBeNull();
    expect(resolvePersonCandidates).not.toHaveBeenCalled();
    expect(res.filters?.personIds).toEqual([]);
  });
});
