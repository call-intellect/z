import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AdminCacheService } from '../../admin/services/admin-cache.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { PendingActionsService } from '../../pending-actions/services/pending-actions.service';

import type { CommitmentReliabilityService } from './commitment-reliability.service';
import { DirectorDashboardService } from './director-dashboard.service';
import type { HangingDecisionsService } from './hanging-decisions.service';
import type { NarrativeCitationsParserService } from './narrative-citations-parser.service';
import type { SentimentIndexService } from './sentiment-index.service';

function buildService(
  opts: {
    getCount?: ReturnType<typeof vi.fn>;
  } = {},
): {
  service: DirectorDashboardService;
  getCount: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    theme: { findMany: vi.fn(async () => []) },
    ideaBlock: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    goal: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    meeting: { count: vi.fn(async () => 0) },
    issue: { count: vi.fn(async () => 0) },
    decision: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
  } as unknown as PrismaService;

  const cache = {
    get: vi.fn(() => null),
    setWithTtl: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as AdminCacheService;

  const llm = { call: vi.fn(async () => ({ text: '' })) } as unknown as LlmRouterService;
  const citations = { parse: vi.fn() } as unknown as NarrativeCitationsParserService;

  const sentimentSvc = {
    getIndex: vi.fn(async () => ({ value: 0, sparkline12w: [], trend: 'flat' })),
  } as unknown as SentimentIndexService;
  const commitSvc = {
    getReliability: vi.fn(async () => ({
      reliabilityPercent: 0,
      sparkline12w: [],
      delta14d: null,
    })),
  } as unknown as CommitmentReliabilityService;
  const hangingSvc = {
    count: vi.fn(async () => ({ count: 0, sparkline12w: [] })),
  } as unknown as HangingDecisionsService;

  const getCount =
    opts.getCount ??
    vi.fn(async () => ({
      total: 3,
      bySource: { curation: 1, conflict: 2, intake: 0, probe: 0 },
    }));
  const pendingActions = { getCount } as unknown as PendingActionsService;

  const config = {
    getDynamic: vi.fn(async <T>(_key: string, _env: string | undefined, def: T): Promise<T> => def),
  } as unknown as TypedConfigService;
  const metrics = {
    incDashboardValueStripServed: vi.fn(),
    setDashboardMainFirstScreenWidgetCount: vi.fn(),
  } as unknown as BusinessMetricsService;

  const service = new DirectorDashboardService(
    prisma,
    cache,
    llm,
    citations,
    sentimentSvc,
    commitSvc,
    hangingSvc,
    pendingActions,
    config,
    metrics,
  );

  return { service, getCount };
}

describe('DirectorDashboardService — requiresAction (B2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('заполняет requiresAction из PendingActionsService.getCount', async () => {
    const { service, getCount } = buildService();
    const dto = await service.getDirectorView({
      tenantId: 't-1',
      period: 'week',
      userId: 'u-1',
    });

    expect(getCount).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1' });
    expect(dto.requiresAction).toEqual({
      total: 3,
      bySource: { curation: 1, conflict: 2, intake: 0, probe: 0 },
    });
  });

  it('ошибка PendingActionsService не валит дашборд → нулевая сводка', async () => {
    const getCount = vi.fn(async () => {
      throw new Error('pending-actions down');
    });
    const { service } = buildService({ getCount });

    const dto = await service.getDirectorView({
      tenantId: 't-1',
      period: 'week',
      userId: 'u-1',
    });

    expect(dto.isEmpty).toBe(true);
    expect(dto.requiresAction).toEqual({
      total: 0,
      bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 },
    });
  });

  it('без userId — requiresAction отсутствует, getCount не вызывается', async () => {
    const { service, getCount } = buildService();
    const dto = await service.getDirectorView({
      tenantId: 't-1',
      period: 'week',
    });

    expect(getCount).not.toHaveBeenCalled();
    expect(dto.requiresAction).toBeUndefined();
  });
});
