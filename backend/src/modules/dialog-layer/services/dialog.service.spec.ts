import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AnswerCacheService } from './answer-cache.service';
import type { ConfidenceEstimatorService } from './confidence-estimator.service';
import type { ContextualizerService } from './contextualizer.service';
import { DialogService } from './dialog.service';
import type { MultiQueryExpansionService } from './multi-query-expansion.service';
import type { QueryClassifierService } from './query-classifier.service';
import type {
  QueryPlanExtractorService,
  QueryPlanResult,
  StructuralRetrievalFilters,
} from './query-plan-extractor.service';

/**
 * Query Understanding Волна 1 (ТЗ 2026-06-10 Ф2) — spec интеграции
 * QueryPlanExtractorService в DialogService.process.
 *
 * Покрывает: проброс queryPlan/structuralFilters при флаге ON; null при
 * applied=false; deep-equal при applied=true; флаг OFF → extractor не вызван;
 * fail-open при исключении extractor.
 */

function emptyPlan(applied: boolean): QueryPlanResult {
  return {
    filters: {
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      themeBranches: [],
      entityHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
    },
    confidence: applied ? 0.9 : 0.2,
    applied,
    durationSeconds: 0.01,
  };
}

interface Mocks {
  extract: ReturnType<typeof vi.fn>;
  resolveStructuralFilters: ReturnType<typeof vi.fn>;
  orgFindUnique: ReturnType<typeof vi.fn>;
}

function makeService(opts: {
  queryPlanExtractionEnabled: boolean;
  dialogLayerEnabled?: boolean;
}): { service: DialogService; mocks: Mocks } {
  const orgFindUnique = vi
    .fn()
    .mockResolvedValue({ timezone: 'Europe/Moscow' });

  const prisma = {
    chatV2Conversation: { findUnique: vi.fn().mockResolvedValue(null) },
    chatV2Message: { findMany: vi.fn().mockResolvedValue([]) },
    org: { findUnique: orgFindUnique },
  } as unknown as PrismaService;

  const cfg = {
    dialogLayer: {
      enabled: opts.dialogLayerEnabled ?? true,
      queryPlanExtractionEnabled: opts.queryPlanExtractionEnabled,
      summarizerKeepLast: 0,
    },
  } as unknown as TypedConfigService;

  const contextualizer = {
    contextualize: vi.fn().mockResolvedValue({
      standaloneQuestion: 'Что решали по маркетингу?',
      llmCalled: false,
      durationSeconds: 0,
    }),
  } as unknown as ContextualizerService;

  const confidence = {
    estimate: vi.fn().mockResolvedValue({
      confidence: 1.0,
      reason: 'identical',
      llmCalled: false,
      durationSeconds: 0,
      shouldFallback: false,
    }),
  } as unknown as ConfidenceEstimatorService;

  const classifier = {
    classify: vi.fn().mockResolvedValue({
      intent: 'factual',
      source: 'heuristic',
      confidence: null,
      durationSeconds: 0,
    }),
  } as unknown as QueryClassifierService;

  const multiQuery = {
    expand: vi.fn().mockResolvedValue({
      queries: ['Что решали по маркетингу?'],
      expanded: false,
      durationSeconds: 0,
    }),
  } as unknown as MultiQueryExpansionService;

  const extract = vi.fn();
  const resolveStructuralFilters = vi.fn();
  const queryPlanExtractor = {
    extract,
    resolveStructuralFilters,
  } as unknown as QueryPlanExtractorService;

  const answerCache = {
    get: vi.fn().mockResolvedValue(null),
  } as unknown as AnswerCacheService;

  const metrics = {
    observeDialogProcessingDuration: vi.fn(),
  } as unknown as BusinessMetricsService;

  const service = new DialogService(
    prisma,
    cfg,
    contextualizer,
    confidence,
    classifier,
    multiQuery,
    queryPlanExtractor,
    answerCache,
    metrics,
  );

  return {
    service,
    mocks: { extract, resolveStructuralFilters, orgFindUnique },
  };
}

function processInput() {
  return {
    tenantId: 'org-1',
    userId: 'user-1',
    userMessage: 'Что решали по маркетингу?',
    conversationId: 'conv-1',
    scope: 'org',
    scopeRefId: null,
    validAt: null,
  } as const;
}

describe('DialogService — Query Understanding Волна 1 (Ф2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applied=false → queryPlan = план (applied=false), structuralFilters=null', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
    });
    const plan = emptyPlan(false);
    mocks.extract.mockResolvedValue(plan);
    mocks.resolveStructuralFilters.mockResolvedValue(null);

    const res = await service.process(processInput());

    expect(res.queryPlan).toBe(plan);
    expect(res.structuralFilters).toBeNull();
  });

  it('applied=true → structuralFilters deep-equals резолвнутый объект', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
    });
    const plan = emptyPlan(true);
    plan.filters.signalTypes = ['decision'];
    const filters: StructuralRetrievalFilters = {
      dateFrom: null,
      dateTo: null,
      signalTypes: ['decision'],
      entityIds: [],
      themeBranches: [],
      bitemporalActiveOnly: false,
    };
    mocks.extract.mockResolvedValue(plan);
    mocks.resolveStructuralFilters.mockResolvedValue(filters);

    const res = await service.process(processInput());

    expect(res.queryPlan).toBe(plan);
    expect(res.structuralFilters).toEqual(filters);
  });

  it('флаг queryPlanExtractionEnabled=false → extractor НЕ вызван, оба null', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: false,
    });

    const res = await service.process(processInput());

    expect(mocks.extract).not.toHaveBeenCalled();
    expect(res.queryPlan ?? null).toBeNull();
    expect(res.structuralFilters ?? null).toBeNull();
  });

  it('extractor бросает → fail-open: structuralFilters=null, process не падает', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
    });
    mocks.extract.mockRejectedValue(new Error('LLM down'));

    const res = await service.process(processInput());

    expect(res.structuralFilters).toBeNull();
    expect(res.queryPlan).toBeNull();
    expect(res.enabled).toBe(true);
  });
});
