import { describe, expect, it, vi } from 'vitest';

import { OperationsDashboardService } from './operations-dashboard.service';

/**
 * ТЗ-2 Ф2 — OperationsDashboardService.getOverview() расширение «зеркало
 * закрытого».
 *
 * Покрываем:
 *   - `blockersResolvedCount` берётся из `blockerSynthesis.count` с фильтром
 *     `status='resolved'` и 30-дневным окном;
 *   - `frictionsResolvedCount` — из `entityLink.count` с
 *     `relationType='conflicted_with', status='archived'` и 30-дневным окном;
 *   - `reworkEnabled` приходит из flag `operations.dashboard_rework.enabled`;
 *   - метрика `setCooBlockersResolved` вызывается с count'ом;
 *   - negative-path: ноль закрытых → 0 в DTO.
 *
 * Redis-кэш не подключаем (Optional inject). Мокаем ВСЕ prisma-вызовы,
 * которые делает getOverview, + config + metrics.
 */
describe('OperationsDashboardService — ТЗ-2 Ф2 resolved counts + reworkEnabled', () => {
  function buildSvc(overrides: {
    blockersResolved?: number;
    frictionsResolved?: number;
    reworkEnabled?: boolean;
  }) {
    const blockerSynthesisCount = vi
      .fn()
      .mockResolvedValue(overrides.blockersResolved ?? 0);
    const entityLinkCount = vi
      .fn()
      .mockResolvedValue(overrides.frictionsResolved ?? 0);

    const prisma = {
      dailyCheckIn: { findMany: vi.fn().mockResolvedValue([]) },
      goal: { count: vi.fn().mockResolvedValue(0) },
      entityLink: {
        findMany: vi.fn().mockResolvedValue([]),
        count: entityLinkCount,
      },
      blockerSynthesis: {
        count: blockerSynthesisCount,
        findMany: vi.fn().mockResolvedValue([]),
      },
      person: { findMany: vi.fn().mockResolvedValue([]) },
      appointment: { findMany: vi.fn().mockResolvedValue([]) },
      insight: { groupBy: vi.fn().mockResolvedValue([]) },
      companyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      functionalDomain: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const getDynamic = vi
      .fn()
      .mockResolvedValue(overrides.reworkEnabled ?? true);
    const cfg = {
      betaOps: { operationsDashboardCacheTtlSeconds: 300 },
      getDynamic,
    };

    const metrics = {
      setOperationsBlockersTotal: vi.fn(),
      setTeamFrictionsTotal: vi.fn(),
      setCooTeamTemperatureRedShare: vi.fn(),
      setCooInsightsByCause: vi.fn(),
      setCooCompanyMaturityScore: vi.fn(),
      setCooBlockersResolved: vi.fn(),
    };

    const svc = new OperationsDashboardService(
      prisma as never,
      cfg as never,
      metrics as never,
    );
    return { svc, prisma, cfg, metrics, blockerSynthesisCount, entityLinkCount };
  }

  it('считает blockersResolvedCount из blockerSynthesis.count (status=resolved, окно 30д)', async () => {
    const { svc, blockerSynthesisCount } = buildSvc({ blockersResolved: 7 });
    const dto = await svc.getOverview({ tenantId: 't1' });

    expect(dto.blockersResolvedCount).toBe(7);
    expect(blockerSynthesisCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          status: 'resolved',
          updatedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
    // Окно ≈ 30 дней назад (допуск ±1 минута на исполнение теста).
    const arg = blockerSynthesisCount.mock.calls[0]?.[0] as {
      where: { updatedAt: { gte: Date } };
    };
    const expected = Date.now() - 30 * 24 * 3_600_000;
    expect(Math.abs(arg.where.updatedAt.gte.getTime() - expected)).toBeLessThan(
      60_000,
    );
  });

  it('считает frictionsResolvedCount из entityLink.count (conflicted_with → archived, окно 30д)', async () => {
    const { svc, entityLinkCount } = buildSvc({ frictionsResolved: 3 });
    const dto = await svc.getOverview({ tenantId: 't1' });

    expect(dto.frictionsResolvedCount).toBe(3);
    expect(entityLinkCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          relationType: 'conflicted_with',
          status: 'archived',
          updatedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });

  it('reworkEnabled приходит из flag operations.dashboard_rework.enabled', async () => {
    const { svc, cfg } = buildSvc({ reworkEnabled: false });
    const dto = await svc.getOverview({ tenantId: 't1' });

    expect(dto.reworkEnabled).toBe(false);
    expect(cfg.getDynamic).toHaveBeenCalledWith(
      'operations.dashboard_rework.enabled',
      undefined,
      true,
    );
  });

  it('публикует метрику setCooBlockersResolved с count', async () => {
    const { svc, metrics } = buildSvc({ blockersResolved: 5 });
    await svc.getOverview({ tenantId: 't1' });

    expect(metrics.setCooBlockersResolved).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5, tenantTop: expect.any(String) }),
    );
  });

  it('negative: ноль закрытых → blockersResolvedCount=0, frictionsResolvedCount=0', async () => {
    const { svc, metrics } = buildSvc({});
    const dto = await svc.getOverview({ tenantId: 't1' });

    expect(dto.blockersResolvedCount).toBe(0);
    expect(dto.frictionsResolvedCount).toBe(0);
    expect(dto.reworkEnabled).toBe(true);
    expect(metrics.setCooBlockersResolved).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0 }),
    );
  });
});
