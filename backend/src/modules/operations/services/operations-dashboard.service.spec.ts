import { describe, expect, it, vi } from 'vitest';

import { OperationsDashboardService } from './operations-dashboard.service';

/**
 * SBA β-8 — OperationsDashboardService unit-тесты.
 *
 * Покрываем агрегацию overview: правильные кол-ва blockers/missed goals/
 * team frictions/capacity. Кэш Redis не подключаем — Optional inject.
 */
describe('OperationsDashboardService', () => {
  const baseCfg = {
    betaOps: {
      operationsDashboardCacheTtlSeconds: 300,
    },
  };

  function buildSvc(overrides: {
    checkIns?: unknown[];
    goalCounts?: { missed: number; cascade: number };
    entityLinks?: unknown[];
    persons?: unknown[];
    appointments?: unknown[];
    /**
     * SBA β-8.3 Wave 2 (Фаза 2) — фикстура для `prisma.insight.groupBy`.
     * Каждый элемент = `{ causeCategory: string | null, count: number }`,
     * мапится в `_count._all`. Дефолт — пусто.
     */
    insightGroupBy?: Array<{ causeCategory: string | null; count: number }>;
    /**
     * SBA β-8.3 Wave 2 (Фаза 3) — фикстура для `companyProfile.findUnique`.
     * Если undefined → возвращаем `null` (нет профиля).
     */
    companyProfile?: {
      maturityScore: { toString(): string } | null;
      lastMaturityCalcAt: Date | null;
      stage: string | null;
    } | null;
    /**
     * SBA β-8.3 Wave 2 (Фаза 3) — `functionalDomain.findMany`.
     * `completeness` — `{ toString(): string }` (имитируем Prisma.Decimal).
     */
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
          // First call = missed, second = cascade.
          const value = goalCallIndex === 0 ? goalMissed : goalCascade;
          goalCallIndex++;
          return Promise.resolve(value);
        }),
      },
      entityLink: {
        findMany: vi.fn().mockResolvedValue(overrides.entityLinks ?? []),
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
            overrides.companyProfile === undefined
              ? null
              : overrides.companyProfile,
          ),
      },
      functionalDomain: {
        findMany: vi.fn().mockResolvedValue(overrides.functionalDomains ?? []),
      },
    };
    const metrics = {
      setOperationsBlockersTotal: vi.fn(),
      setTeamFrictionsTotal: vi.fn(),
      // SBA β-8.1 — getOverview теперь вызывает setCooTeamTemperatureRedShare.
      setCooTeamTemperatureRedShare: vi.fn(),
      // SBA β-8.3 Wave 2 — карта причин + зрелость.
      setCooInsightsByCause: vi.fn(),
      setCooCompanyMaturityScore: vi.fn(),
    };
    const svc = new OperationsDashboardService(
      prisma as never,
      baseCfg as never,
      metrics as never,
    );
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
    // SBA β-8.3 Wave 2 (Фаза 2) — все 8 ключей всегда заполнены нулями.
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
    expect(
      Object.values(dto.insightsByCauseCategory).every((v) => v === 0),
    ).toBe(true);
    // SBA β-8.3 Wave 2 (Фаза 3) — пустой профиль + 0 доменов.
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

  // SBA β-8.3 Wave 2 (Фаза 2) — карта причин.
  it('overview: агрегирует insightsByCauseCategory + NULL→unknown', async () => {
    const { svc, metrics } = buildSvc({
      insightGroupBy: [
        { causeCategory: 'process_gap', count: 4 },
        { causeCategory: 'tooling', count: 2 },
        { causeCategory: 'unknown', count: 1 },
        // NULL → должен попасть в bucket 'unknown'
        { causeCategory: null, count: 3 },
        // значение вне whitelist'а → тоже в 'unknown' (защита от мусора).
        { causeCategory: 'invalid_value', count: 5 },
      ],
    });
    const dto = await svc.getOverview({ tenantId: 't1' });
    expect(dto.insightsByCauseCategory.process_gap).toBe(4);
    expect(dto.insightsByCauseCategory.tooling).toBe(2);
    // 1 (явно unknown) + 3 (NULL) + 5 (мусор) = 9
    expect(dto.insightsByCauseCategory.unknown).toBe(9);
    // Остальные нули.
    expect(dto.insightsByCauseCategory.role_skill).toBe(0);
    expect(dto.insightsByCauseCategory.communication).toBe(0);
    expect(dto.insightsByCauseCategory.priority).toBe(0);
    expect(dto.insightsByCauseCategory.resource_constraint).toBe(0);
    expect(dto.insightsByCauseCategory.external).toBe(0);
    // Все 8 ключей публикуются в метрику.
    expect(metrics.setCooInsightsByCause).toHaveBeenCalledTimes(8);
  });

  // SBA β-8.3 Wave 2 (Фаза 3) — снапшот зрелости.
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

    // weakestDomains: ASC по completeness — топ-3.
    expect(dto.maturity.weakestDomains).toHaveLength(3);
    expect(dto.maturity.weakestDomains[0]?.slug).toBe('rnd');
    expect(dto.maturity.weakestDomains[0]?.completeness).toBeCloseTo(0.1);
    expect(dto.maturity.weakestDomains[1]?.slug).toBe('hr');
    expect(dto.maturity.weakestDomains[2]?.slug).toBe('finance');

    // topDomains: DESC по completeness — топ-3.
    expect(dto.maturity.topDomains).toHaveLength(3);
    expect(dto.maturity.topDomains[0]?.slug).toBe('sales');
    expect(dto.maturity.topDomains[0]?.completeness).toBeCloseTo(0.9);
    expect(dto.maturity.topDomains[1]?.slug).toBe('marketing');
    expect(dto.maturity.topDomains[2]?.slug).toBe('finance');

    // Метрика maturity score публикуется (score !== null).
    expect(metrics.setCooCompanyMaturityScore).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.any(Number) }),
    );
  });

  // SBA β-8.3 Wave 2 (Фаза 3) — score=null → метрика НЕ публикуется.
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
