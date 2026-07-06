import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AdminCacheService } from './admin-cache.service';
import { AdminUsageService } from './admin-usage.service';

function buildPrismaMock(findMany: ReturnType<typeof vi.fn>): {
  prisma: PrismaService;
} {
  const base = {
    aiUsageLog: { findMany },
    meeting: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: base as unknown as PrismaService };
}

function buildCacheMock(): AdminCacheService {
  return {
    get: vi.fn().mockReturnValue(undefined),
    setWithTtl: vi.fn(),
  } as unknown as AdminCacheService;
}

type GroupByRow = Record<string, unknown> & {
  _sum: { costUsd: number };
  _count: { _all: number };
};

function buildDashboardPrismaMock(rows: {
  totalCost?: number;
  totalCalls?: number;
  failedCalls?: number;
  byProvider?: Array<{ provider: string; costUsd: number; calls: number }>;
  byModel?: Array<{ provider: string; model: string; costUsd: number; calls: number }>;
  byTaskType?: Array<{ taskType: string; costUsd: number; calls: number }>;
  trend?: Array<{ day: Date; cost: number; calls: number; failed: number }>;
}): {
  prisma: PrismaService;
  aggregate: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const byProvider: GroupByRow[] = (rows.byProvider ?? []).map((r) => ({
    provider: r.provider,
    _sum: { costUsd: r.costUsd },
    _count: { _all: r.calls },
  }));
  const byModel: GroupByRow[] = (rows.byModel ?? []).map((r) => ({
    provider: r.provider,
    model: r.model,
    _sum: { costUsd: r.costUsd },
    _count: { _all: r.calls },
  }));
  const byTaskType: GroupByRow[] = (rows.byTaskType ?? []).map((r) => ({
    taskType: r.taskType,
    _sum: { costUsd: r.costUsd },
    _count: { _all: r.calls },
  }));

  const aggregate = vi.fn().mockResolvedValue({
    _sum: { costUsd: rows.totalCost ?? 0 },
    _count: { _all: rows.totalCalls ?? 0 },
  });
  const count = vi.fn().mockResolvedValue(rows.failedCalls ?? 0);
  const groupBy = vi.fn().mockImplementation((args: { by: string[] }) => {
    const by = args.by;
    if (by.length === 2 && by[0] === 'provider' && by[1] === 'model') {
      return Promise.resolve(byModel);
    }
    if (by.length === 1 && by[0] === 'provider') return Promise.resolve(byProvider);
    if (by.length === 1 && by[0] === 'taskType') return Promise.resolve(byTaskType);
    if (by.length === 1 && by[0] === 'tenantId') return Promise.resolve([]);
    throw new Error(`unexpected groupBy: ${JSON.stringify(args)}`);
  });
  const queryRaw = vi.fn().mockResolvedValue(rows.trend ?? []);

  const prisma = {
    aiUsageLog: { aggregate, count, groupBy },
    $queryRaw: queryRaw,
    org: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    user: { count: vi.fn().mockResolvedValue(0) },
  };
  return { prisma: prisma as unknown as PrismaService, aggregate, groupBy, queryRaw };
}

describe('AdminUsageService.getCallsLog', () => {
  it('строит prisma where с meetingId при фильтре по встрече', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { prisma } = buildPrismaMock(findMany);
    const svc = new AdminUsageService(prisma, buildCacheMock());

    await svc.getCallsLog({ scope: 'global', meetingId: 'mtg_x', limit: 50 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ meetingId: 'mtg_x' }),
      }),
    );
  });
});

describe('AdminUsageService.getDashboard', () => {
  it('прокидывает provider/model/taskType фильтры в baseWhere всех groupBy', async () => {
    const { prisma, groupBy } = buildDashboardPrismaMock({});
    const svc = new AdminUsageService(prisma, buildCacheMock());

    await svc.getDashboard({
      scope: 'global',
      period: 'week',
      provider: 'kie',
      model: 'gemini-3.1-pro',
      taskType: 'summary',
    });

    for (const call of groupBy.mock.calls) {
      const args = call[0] as { where: Record<string, unknown> };
      expect(args.where).toMatchObject({
        provider: 'kie',
        model: 'gemini-3.1-pro',
        taskType: 'summary',
      });
    }
  });

  it('scope=global + orgId фильтрует tenantId в baseWhere', async () => {
    const { prisma, groupBy } = buildDashboardPrismaMock({});
    const svc = new AdminUsageService(prisma, buildCacheMock());

    await svc.getDashboard({ scope: 'global', period: 'week', orgId: 'org_1' });

    const firstCall = groupBy.mock.calls[0];
    if (!firstCall) throw new Error('groupBy не вызван');
    const call = firstCall[0] as { where: Record<string, unknown> };
    expect(call.where).toMatchObject({ tenantId: 'org_1' });
  });

  it('byModel группирует по provider+model, сортирует по costUsd desc', async () => {
    const { prisma } = buildDashboardPrismaMock({
      byModel: [
        { provider: 'kie', model: 'gemini-3.1-pro', costUsd: 1, calls: 5 },
        { provider: 'grsai', model: 'gemini-3.1-pro', costUsd: 9, calls: 2 },
      ],
    });
    const svc = new AdminUsageService(prisma, buildCacheMock());

    const result = await svc.getDashboard({ scope: 'global', period: 'week' });

    expect(result.byModel).toEqual([
      { provider: 'grsai', model: 'gemini-3.1-pro', costUsd: 9, calls: 2 },
      { provider: 'kie', model: 'gemini-3.1-pro', costUsd: 1, calls: 5 },
    ]);
  });

  it('trend читает из $queryRaw и конвертирует day→date (YYYY-MM-DD)', async () => {
    const { prisma, queryRaw } = buildDashboardPrismaMock({
      trend: [
        { day: new Date('2026-07-01T00:00:00.000Z'), cost: 1.5, calls: 3, failed: 1 },
        { day: new Date('2026-07-02T00:00:00.000Z'), cost: 2.25, calls: 4, failed: 0 },
      ],
    });
    const svc = new AdminUsageService(prisma, buildCacheMock());

    const result = await svc.getDashboard({ scope: 'global', period: 'week' });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.trend).toEqual([
      { date: '2026-07-01', costUsd: 1.5, calls: 3, failedCalls: 1 },
      { date: '2026-07-02', costUsd: 2.25, calls: 4, failedCalls: 0 },
    ]);
  });
});
