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
    };
    const metrics = {
      setOperationsBlockersTotal: vi.fn(),
      setTeamFrictionsTotal: vi.fn(),
      // SBA β-8.1 — getOverview теперь вызывает setCooTeamTemperatureRedShare.
      setCooTeamTemperatureRedShare: vi.fn(),
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
