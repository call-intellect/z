import { describe, expect, it, vi } from 'vitest';

import { bucketizeWeeklyInflow, OperationsDashboardService } from './operations-dashboard.service';

describe('OperationsDashboardService', () => {
  const baseCfg = {
    betaOps: {
      operationsDashboardCacheTtlSeconds: 300,
    },
    getDynamic: vi.fn().mockResolvedValue(true),
  };

  function buildSvc(overrides: {
    checkIns?: unknown[];
    goalCounts?: { missed: number; cascade: number };
    entityLinks?: unknown[];
    persons?: unknown[];
    appointments?: unknown[];
    insightGroupBy?: Array<{ causeCategory: string | null; count: number }>;
    companyProfile?: {
      maturityScore: { toString(): string } | null;
      lastMaturityCalcAt: Date | null;
      stage: string | null;
    } | null;
    functionalDomains?: Array<{
      slug: string;
      name: string;
      completeness: { toString(): string } | null;
    }>;
  }) {
    const goalMissed = overrides.goalCounts?.missed ?? 0;
    const goalCascade = overrides.goalCounts?.cascade ?? 0;
    let goalCallIndex = 0;
    const prisma = {
      dailyCheckIn: {
        findMany: vi.fn().mockResolvedValue(overrides.checkIns ?? []),
      },
      goal: {
        count: vi.fn().mockImplementation(() => {
          const value = goalCallIndex === 0 ? goalMissed : goalCascade;
          goalCallIndex++;
          return Promise.resolve(value);
        }),
      },
      entityLink: {
        findMany: vi.fn().mockResolvedValue(overrides.entityLinks ?? []),
        count: vi.fn().mockResolvedValue(0),
      },
      blockerSynthesis: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      person: {
        findMany: vi.fn().mockResolvedValue(overrides.persons ?? []),
      },
      appointment: {
        findMany: vi.fn().mockResolvedValue(overrides.appointments ?? []),
      },
      insight: {
        groupBy: vi.fn().mockResolvedValue(
          (overrides.insightGroupBy ?? []).map((r) => ({
            causeCategory: r.causeCategory,
            _count: { _all: r.count },
          })),
        ),
      },
      companyProfile: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            overrides.companyProfile === undefined ? null : overrides.companyProfile,
          ),
      },
      functionalDomain: {
        findMany: vi.fn().mockResolvedValue(overrides.functionalDomains ?? []),
      },
    };
    const metrics = {
      setOperationsBlockersTotal: vi.fn(),
      setTeamFrictionsTotal: vi.fn(),
      setCooTeamTemperatureRedShare: vi.fn(),
      setCooInsightsByCause: vi.fn(),
      setCooCompanyMaturityScore: vi.fn(),
      setCooBlockersResolved: vi.fn(),
    };
    const svc = new OperationsDashboardService(prisma as never, baseCfg as never, metrics as never);
    return { svc, prisma, metrics };
  }

  it('overview: пустые источники → нули + пустые массивы', async () => {
    const { svc } = buildSvc({});
    const dto = await svc.getOverview({ tenantId: 't1' });
    expect(dto.blockersCount).toBe(0);
    expect(dto.missedGoalsCount).toBe(0);
    expect(dto.cascadeMissedCount).toBe(0);
    expect(dto.teamFrictionCount).toBe(0);
    expect(dto.capacityAvgPercent).toBe(0);
    expect(dto.topRecentBlockers).toEqual([]);
    expect(dto.topRecentTeamFrictions).toEqual([]);
    expect(Object.keys(dto.insightsByCauseCategory).sort()).toEqual(
      [
        'communication',
        'external',
        'priority',
        'process_gap',
        'resource_constraint',
        'role_skill',
        'tooling',
        'unknown',
      ].sort(),
    );
    expect(Object.values(dto.insightsByCauseCategory).every((v) => v === 0)).toBe(true);
    expect(dto.maturity.score).toBeNull();
    expect(dto.maturity.lastCalcAt).toBeNull();
    expect(dto.maturity.stage).toBeNull();
    expect(dto.maturity.weakestDomains).toEqual([]);
    expect(dto.maturity.topDomains).toEqual([]);
  });

  it('overview: считает блокеры из DailyCheckIn.blockersJson', async () => {
    const { svc, metrics } = buildSvc({
      checkIns: [
        {
          id: 'cin1',
          personId: 'p1',
          person: { name: 'Анна' },
          blockersJson: [
            { text: 'нет доступа к S3', severity: 'high' },
            { text: 'жду ответ от поставщика', severity: 'medium' },
          ],
          createdAt: new Date('2026-05-23T10:00:00Z'),
        },
      ],
    });
    const dto = await svc.getOverview({ tenantId: 't1' });
    expect(dto.blockersCount).toBe(2);
    expect(dto.blockersBySeverity.high).toBe(1);
    expect(dto.blockersBySeverity.medium).toBe(1);
    expect(dto.topRecentBlockers).toHaveLength(2);
    expect(metrics.setOperationsBlockersTotal).toHaveBeenCalled();
    expect(metrics.setTeamFrictionsTotal).toHaveBeenCalled();
  });

  it('overview: миссед / cascade goals из counts', async () => {
    const { svc } = buildSvc({
      goalCounts: { missed: 5, cascade: 3 },
    });
    const dto = await svc.getOverview({ tenantId: 't1' });
    expect(dto.missedGoalsCount).toBe(5);
    expect(dto.cascadeMissedCount).toBe(3);
  });

  it('overview: агрегирует insightsByCauseCategory + NULL→unknown', async () => {
    const { svc, metrics } = buildSvc({
      insightGroupBy: [
        { causeCategory: 'process_gap', count: 4 },
        { causeCategory: 'tooling', count: 2 },
        { causeCategory: 'unknown', count: 1 },
        { causeCategory: null, count: 3 },
        { causeCategory: 'invalid_value', count: 5 },
      ],
    });
    const dto = await svc.getOverview({ tenantId: 't1' });
    expect(dto.insightsByCauseCategory.process_gap).toBe(4);
    expect(dto.insightsByCauseCategory.tooling).toBe(2);
    expect(dto.insightsByCauseCategory.unknown).toBe(9);
    expect(dto.insightsByCauseCategory.role_skill).toBe(0);
    expect(dto.insightsByCauseCategory.communication).toBe(0);
    expect(dto.insightsByCauseCategory.priority).toBe(0);
    expect(dto.insightsByCauseCategory.resource_constraint).toBe(0);
    expect(dto.insightsByCauseCategory.external).toBe(0);
    expect(metrics.setCooInsightsByCause).toHaveBeenCalledTimes(8);
  });

  it('overview: maturity снапшот сортирует weakest/top по completeness', async () => {
    const { svc, metrics } = buildSvc({
      companyProfile: {
        maturityScore: { toString: () => '0.42' },
        lastMaturityCalcAt: new Date('2026-05-25T05:00:00Z'),
        stage: 'growth',
      },
      functionalDomains: [
        { slug: 'sales', name: 'Продажи', completeness: { toString: () => '0.9' } },
        { slug: 'marketing', name: 'Маркетинг', completeness: { toString: () => '0.7' } },
        { slug: 'finance', name: 'Финансы', completeness: { toString: () => '0.5' } },
        { slug: 'hr', name: 'HR', completeness: { toString: () => '0.3' } },
        { slug: 'rnd', name: 'R&D', completeness: { toString: () => '0.1' } },
      ],
    });
    const dto = await svc.getOverview({ tenantId: 't1' });

    expect(dto.maturity.score).toBeCloseTo(0.42);
    expect(dto.maturity.lastCalcAt).toBe('2026-05-25T05:00:00.000Z');
    expect(dto.maturity.stage).toBe('growth');

    expect(dto.maturity.weakestDomains).toHaveLength(3);
    expect(dto.maturity.weakestDomains[0]?.slug).toBe('rnd');
    expect(dto.maturity.weakestDomains[0]?.completeness).toBeCloseTo(0.1);
    expect(dto.maturity.weakestDomains[1]?.slug).toBe('hr');
    expect(dto.maturity.weakestDomains[2]?.slug).toBe('finance');

    expect(dto.maturity.topDomains).toHaveLength(3);
    expect(dto.maturity.topDomains[0]?.slug).toBe('sales');
    expect(dto.maturity.topDomains[0]?.completeness).toBeCloseTo(0.9);
    expect(dto.maturity.topDomains[1]?.slug).toBe('marketing');
    expect(dto.maturity.topDomains[2]?.slug).toBe('finance');

    expect(metrics.setCooCompanyMaturityScore).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.any(Number) }),
    );
  });

  it('overview: maturity score=null → метрика maturity не публикуется', async () => {
    const { svc, metrics } = buildSvc({
      companyProfile: {
        maturityScore: null,
        lastMaturityCalcAt: null,
        stage: null,
      },
      functionalDomains: [],
    });
    const dto = await svc.getOverview({ tenantId: 't1' });
    expect(dto.maturity.score).toBeNull();
    expect(metrics.setCooCompanyMaturityScore).not.toHaveBeenCalled();
  });

  it('capacity: суммирует loadPercent + считает overloaded (>100)', async () => {
    const { svc } = buildSvc({
      appointments: [
        {
          personId: 'p1',
          loadPercent: 80,
          person: { id: 'p1', name: 'Анна' },
        },
        {
          personId: 'p1',
          loadPercent: 40,
          person: { id: 'p1', name: 'Анна' },
        },
        {
          personId: 'p2',
          loadPercent: 60,
          person: { id: 'p2', name: 'Борис' },
        },
      ],
    });
    const cap = await svc.getCapacity({ tenantId: 't1' });
    expect(cap.items).toHaveLength(2);
    const anna = cap.items.find((i) => i.personName === 'Анна');
    expect(anna?.loadPercent).toBe(120);
    expect(cap.overloadedCount).toBe(1);
  });
});

describe('bucketizeWeeklyInflow', () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-10T12:00:00Z');

  function eventInWeek(i: number): Date {
    return new Date(now.getTime() - (11.5 - i) * WEEK);
  }

  it('раскладывает события по нужным неделям (i=0,5,11), остальные null', () => {
    const result = bucketizeWeeklyInflow([eventInWeek(0), eventInWeek(5), eventInWeek(11)], now);
    expect(result).toHaveLength(12);
    expect(result[0]).toBe(1);
    expect(result[5]).toBe(1);
    expect(result[11]).toBe(1);
    for (const idx of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
      expect(result[idx]).toBeNull();
    }
  });

  it('пустой массив → 12 элементов, все null', () => {
    const result = bucketizeWeeklyInflow([], now);
    expect(result).toHaveLength(12);
    expect(result.every((v) => v === null)).toBe(true);
  });

  it('несколько событий в одной неделе → count > 1', () => {
    const result = bucketizeWeeklyInflow([eventInWeek(3), eventInWeek(3), eventInWeek(3)], now);
    expect(result[3]).toBe(3);
    for (let i = 0; i < 12; i++) {
      if (i !== 3) expect(result[i]).toBeNull();
    }
  });

  it('события вне окна (раньше start / позже now) игнорируются', () => {
    const before = new Date(now.getTime() - 13 * WEEK);
    const future = new Date(now.getTime() + WEEK);
    const atNow = new Date(now.getTime());
    const result = bucketizeWeeklyInflow([before, future, atNow], now);
    expect(result.every((v) => v === null)).toBe(true);
  });
});
