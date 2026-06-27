import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AnswerCacheService } from './answer-cache.service';
import { DialogService } from './dialog.service';
import type { MultiQueryExpansionService } from './multi-query-expansion.service';
import type { QueryClassifierService } from './query-classifier.service';
import type {
  QueryPlanExtractorService,
  QueryPlanResult,
  StructuralRetrievalFilters,
} from './query-plan-extractor.service';

function emptyPlan(applied: boolean): QueryPlanResult {
  return {
    filters: {
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      themeBranches: [],
      entityHints: [],
      personHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
    },
    queryClass: 'topic',
    queryClassConfidence: 0.4,
    confidence: applied ? 0.9 : 0.2,
    applied,
    durationSeconds: 0.01,
  };
}

interface Mocks {
  classify: ReturnType<typeof vi.fn>;
  expand: ReturnType<typeof vi.fn>;
  extract: ReturnType<typeof vi.fn>;
  understand: ReturnType<typeof vi.fn>;
  resolveStructuralFilters: ReturnType<typeof vi.fn>;
  answerCacheGet: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
  chatMessageFindMany: ReturnType<typeof vi.fn>;
  chatConvFindUnique: ReturnType<typeof vi.fn>;
}

function makeService(opts: {
  queryPlanExtractionEnabled: boolean;
  dialogLayerEnabled?: boolean;
  expandQueries?: string[];
  understandingMerged?: boolean;
  understandQueries?: string[];
  understandPlan?: QueryPlanResult;
}): { service: DialogService; mocks: Mocks } {
  const orgFindUnique = vi.fn().mockResolvedValue({ timezone: 'Europe/Moscow' });
  const chatConvFindUnique = vi.fn().mockResolvedValue(null);
  const chatMessageFindMany = vi.fn().mockResolvedValue([]);

  const prisma = {
    chatV2Conversation: { findUnique: chatConvFindUnique },
    chatV2Message: { findMany: chatMessageFindMany },
    org: { findUnique: orgFindUnique },
  } as unknown as PrismaService;

  const merged = opts.understandingMerged ?? false;
  const getDynamic = vi.fn(async (key: string) => {
    if (key === 'rag.understanding_merged') return merged;
    return 4;
  });

  const cfg = {
    dialogLayer: {
      enabled: opts.dialogLayerEnabled ?? true,
      queryPlanExtractionEnabled: opts.queryPlanExtractionEnabled,
    },
    getDynamic,
  } as unknown as TypedConfigService;

  const classify = vi.fn().mockResolvedValue({
    intent: 'factual',
    source: 'heuristic',
    confidence: null,
    durationSeconds: 0,
  });
  const classifier = { classify } as unknown as QueryClassifierService;

  const expand = vi.fn().mockResolvedValue({
    queries: opts.expandQueries ?? [
      'а сколько это стоит?',
      'Сколько стоит продукт Маяк?',
      'Из чего складывается цена Маяк?',
      'Есть ли скидки по Маяк?',
    ],
    expanded: true,
    durationSeconds: 0.02,
  });
  const multiQuery = { expand } as unknown as MultiQueryExpansionService;

  const extract = vi.fn().mockResolvedValue(emptyPlan(false));
  const understand = vi.fn().mockResolvedValue({
    queries: opts.understandQueries ?? [
      'а сколько это стоит?',
      'Сколько стоит продукт Маяк?',
      'Из чего складывается цена Маяк?',
    ],
    queryPlan: opts.understandPlan ?? emptyPlan(false),
  });
  const resolveStructuralFilters = vi.fn().mockResolvedValue(null);
  const queryPlanExtractor = {
    extract,
    understand,
    resolveStructuralFilters,
  } as unknown as QueryPlanExtractorService;

  const answerCacheGet = vi.fn().mockResolvedValue(null);
  const answerCache = {
    get: answerCacheGet,
  } as unknown as AnswerCacheService;

  const metrics = {
    observeDialogProcessingDuration: vi.fn(),
    incQueryPlanExtraction: vi.fn(),
    incRouterQueryClass: vi.fn(),
  } as unknown as BusinessMetricsService;

  const service = new DialogService(
    prisma,
    cfg,
    classifier,
    multiQuery,
    queryPlanExtractor,
    answerCache,
    metrics,
  );

  return {
    service,
    mocks: {
      classify,
      expand,
      extract,
      understand,
      resolveStructuralFilters,
      answerCacheGet,
      getDynamic,
      chatMessageFindMany,
      chatConvFindUnique,
    },
  };
}

function processInput() {
  return {
    tenantId: 'org-1',
    userId: 'user-1',
    userMessage: 'а сколько это стоит?',
    conversationId: 'conv-1',
    scope: 'org',
    scopeRefId: null,
    validAt: null,
  } as const;
}

describe('DialogService — слитый модуль понимания запроса (ТЗ 2026-06-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classify вызван с сырым userMessage (не с контекстуализованным)', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: false,
    });

    await service.process(processInput());

    expect(mocks.classify).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'а сколько это стоит?' }),
    );
  });

  it('summary + history переданы в multiQuery.expand', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: false,
    });
    mocks.chatConvFindUnique.mockResolvedValue({ summary: 'Про продукт Маяк.' });
    mocks.chatMessageFindMany.mockResolvedValue([{ role: 'user', text: 'Что по Маяк?' }]);

    await service.process(processInput());

    expect(mocks.expand).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'а сколько это стоит?',
        summary: 'Про продукт Маяк.',
        history: [{ role: 'user', content: 'Что по Маяк?' }],
      }),
    );
  });

  it('queryPlanExtractor.extract вызван ПОСЛЕ expand с questions = mq.queries.slice(1)', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
    });

    await service.process(processInput());

    expect(mocks.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          'Сколько стоит продукт Маяк?',
          'Из чего складывается цена Маяк?',
          'Есть ли скидки по Маяк?',
        ],
      }),
    );
    const expandOrder = mocks.expand.mock.invocationCallOrder[0] ?? 0;
    const extractOrder = mocks.extract.mock.invocationCallOrder[0] ?? 0;
    expect(expandOrder).toBeLessThan(extractOrder);
  });

  it('если expand вернул только оригинал — extract получает его (slice не пустой)', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
      expandQueries: ['а сколько это стоит?'],
    });

    await service.process(processInput());

    expect(mocks.extract).toHaveBeenCalledWith(
      expect.objectContaining({ questions: ['а сколько это стоит?'] }),
    );
  });

  it('standaloneQuestion = сырая реплика, confidence = 1.0, steps.contextualize/confidence = 0', async () => {
    const { service } = makeService({ queryPlanExtractionEnabled: false });

    const res = await service.process(processInput());

    expect(res.standaloneQuestion).toBe('а сколько это стоит?');
    expect(res.confidence).toBe(1.0);
    expect(res.steps.contextualize).toBe(0);
    expect(res.steps.confidence).toBe(0);
  });

  it('!enabled → noop: standaloneQuestion = userMessage, extract не вызван', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
      dialogLayerEnabled: false,
    });

    const res = await service.process(processInput());

    expect(res.enabled).toBe(false);
    expect(res.standaloneQuestion).toBe('а сколько это стоит?');
    expect(res.queries).toEqual(['а сколько это стоит?']);
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.expand).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it('applied=true → structuralFilters проброшены', async () => {
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
      personIds: [],
      themeBranches: [],
      bitemporalActiveOnly: false,
    };
    mocks.extract.mockResolvedValue(plan);
    mocks.resolveStructuralFilters.mockResolvedValue(filters);

    const res = await service.process(processInput());

    expect(res.queryPlan).toBe(plan);
    expect(res.structuralFilters).toEqual(filters);
  });

  it('extractor бросает → fail-open: оба null, process не падает', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
    });
    mocks.extract.mockRejectedValue(new Error('LLM down'));

    const res = await service.process(processInput());

    expect(res.queryPlan).toBeNull();
    expect(res.structuralFilters).toBeNull();
    expect(res.enabled).toBe(true);
  });
});

describe('DialogService — рубильник rag.understanding_merged (Ф4b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merged=true → один understand, ноль expand/extract; план резолвится', async () => {
    const plan = emptyPlan(true);
    plan.filters.signalTypes = ['decision'];
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
      understandingMerged: true,
      understandPlan: plan,
    });
    const filters: StructuralRetrievalFilters = {
      dateFrom: null,
      dateTo: null,
      signalTypes: ['decision'],
      entityIds: [],
      personIds: [],
      themeBranches: [],
      bitemporalActiveOnly: false,
    };
    mocks.resolveStructuralFilters.mockResolvedValue(filters);

    const res = await service.process(processInput());

    expect(mocks.understand).toHaveBeenCalledTimes(1);
    expect(mocks.understand).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'а сколько это стоит?' }),
    );
    expect(mocks.expand).not.toHaveBeenCalled();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(res.queries).toEqual([
      'а сколько это стоит?',
      'Сколько стоит продукт Маяк?',
      'Из чего складывается цена Маяк?',
    ]);
    expect(res.queryPlan).toBe(plan);
    expect(res.structuralFilters).toEqual(filters);
    expect(mocks.resolveStructuralFilters).toHaveBeenCalledWith(
      expect.objectContaining({ plan }),
    );
  });

  it('merged=false → старый путь: expand + extract, без understand', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: true,
      understandingMerged: false,
    });

    await service.process(processInput());

    expect(mocks.understand).not.toHaveBeenCalled();
    expect(mocks.expand).toHaveBeenCalledTimes(1);
    expect(mocks.extract).toHaveBeenCalledTimes(1);
  });

  it('input.intent задан → classify НЕ вызывается, intent проброшен', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: false,
      understandingMerged: true,
    });

    const res = await service.process({ ...processInput(), intent: 'analytical' });

    expect(mocks.classify).not.toHaveBeenCalled();
    expect(res.intent).toBe('analytical');
  });

  it('input.intent НЕ задан → classify вызывается как раньше', async () => {
    const { service, mocks } = makeService({
      queryPlanExtractionEnabled: false,
      understandingMerged: true,
    });

    await service.process(processInput());

    expect(mocks.classify).toHaveBeenCalledTimes(1);
  });
});
