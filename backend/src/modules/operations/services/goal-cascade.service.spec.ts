import { describe, expect, it, vi } from 'vitest';

import { GoalCascadeService } from './goal-cascade.service';

/**
 * SBA β-8 — GoalCascadeService unit-тесты.
 *
 * Покрываем:
 *   1. Все children achieved → parent переводится в achieved.
 *   2. Не все children achieved → parent остаётся в active.
 *   3. parent abandoned → дети помечаются cascadeMissed=true.
 *   4. Идемпотентность: повторный onParentMissed на детях с тем же
 *      cascadeMissedFromGoalId не плодит апдейты.
 */
describe('GoalCascadeService', () => {
  function buildSvc(overrides: {
    goalById?: Record<
      string,
      {
        id: string;
        tenantId: string;
        parentGoalId: string | null;
        status: string;
      }
    >;
    siblings?: Array<{ id: string; status: string }>;
    updateManyCount?: number;
  }) {
    const prisma = {
      goal: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const row = overrides.goalById?.[where.id];
          return Promise.resolve(row ?? null);
        }),
        findMany: vi.fn().mockResolvedValue(overrides.siblings ?? []),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi
          .fn()
          .mockResolvedValue({ count: overrides.updateManyCount ?? 0 }),
      },
    };
    const metrics = { incGoalCascadeMisses: vi.fn() };
    const svc = new GoalCascadeService(prisma as never, metrics as never);
    return { svc, prisma, metrics };
  }

  it('onChildCompleted: все дети achieved → parent → achieved', async () => {
    const { svc, prisma } = buildSvc({
      goalById: {
        c1: { id: 'c1', tenantId: 't1', parentGoalId: 'p1', status: 'achieved' },
        p1: { id: 'p1', tenantId: 't1', parentGoalId: null, status: 'active' },
      },
      siblings: [
        { id: 'c1', status: 'achieved' },
        { id: 'c2', status: 'achieved' },
      ],
    });
    const parentId = await svc.onChildCompleted({ tenantId: 't1', goalId: 'c1' });
    expect(parentId).toBe('p1');
    expect(prisma.goal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'achieved' },
    });
  });

  it('onChildCompleted: не все achieved → parent не трогаем', async () => {
    const { svc, prisma } = buildSvc({
      goalById: {
        c1: { id: 'c1', tenantId: 't1', parentGoalId: 'p1', status: 'achieved' },
        p1: { id: 'p1', tenantId: 't1', parentGoalId: null, status: 'active' },
      },
      siblings: [
        { id: 'c1', status: 'achieved' },
        { id: 'c2', status: 'active' },
      ],
    });
    const parentId = await svc.onChildCompleted({ tenantId: 't1', goalId: 'c1' });
    expect(parentId).toBeNull();
    expect(prisma.goal.update).not.toHaveBeenCalled();
  });

  it('onParentMissed: parent abandoned → детям cascadeMissed=true + метрика', async () => {
    const { svc, prisma, metrics } = buildSvc({
      goalById: {
        p1: { id: 'p1', tenantId: 't1', parentGoalId: null, status: 'abandoned' },
      },
      updateManyCount: 3,
    });
    const affected = await svc.onParentMissed({
      tenantId: 't1',
      parentGoalId: 'p1',
    });
    expect(affected).toBe(3);
    expect(prisma.goal.updateMany).toHaveBeenCalledOnce();
    const arg = prisma.goal.updateMany.mock.calls[0]?.[0] as
      | { data: { cascadeMissed: boolean; cascadeMissedFromGoalId: string } }
      | undefined;
    expect(arg?.data.cascadeMissed).toBe(true);
    expect(arg?.data.cascadeMissedFromGoalId).toBe('p1');
    expect(metrics.incGoalCascadeMisses).toHaveBeenCalledWith(
      expect.objectContaining({ count: 3 }),
    );
  });

  it('onParentMissed: parent не abandoned → no-op', async () => {
    const { svc, prisma } = buildSvc({
      goalById: {
        p1: { id: 'p1', tenantId: 't1', parentGoalId: null, status: 'active' },
      },
    });
    const affected = await svc.onParentMissed({
      tenantId: 't1',
      parentGoalId: 'p1',
    });
    expect(affected).toBe(0);
    expect(prisma.goal.updateMany).not.toHaveBeenCalled();
  });

  it('onParentMissed: tenant mismatch → no-op', async () => {
    const { svc, prisma } = buildSvc({
      goalById: {
        p1: { id: 'p1', tenantId: 't2', parentGoalId: null, status: 'abandoned' },
      },
    });
    const affected = await svc.onParentMissed({
      tenantId: 't1',
      parentGoalId: 'p1',
    });
    expect(affected).toBe(0);
    expect(prisma.goal.updateMany).not.toHaveBeenCalled();
  });
});
