import { describe, expect, it, vi } from 'vitest';

import { GoalTaskLinkerCron } from './goal-task-linker.cron';

function buildCron() {
  const prisma = {
    org: { findMany: vi.fn().mockResolvedValue([]) },
    goal: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const linker = { linkGoalTasks: vi.fn().mockResolvedValue({ linked: 0 }) };
  const gate = { checkOrThrow: vi.fn().mockResolvedValue(undefined) };
  const cfg = {
    getDynamic: vi.fn(async (_k: string, _e: unknown, fallback: unknown) => fallback),
  };
  const cron = new GoalTaskLinkerCron(
    prisma as never,
    linker as never,
    gate as never,
    cfg as never,
  );
  return { cron, prisma, linker, gate };
}

describe('GoalTaskLinkerCron', () => {
  it('пустой список Org → не падает, ничего не привязывает', async () => {
    const { cron, linker } = buildCron();
    const summary = await cron.scanAllOrgs();
    expect(summary).toEqual({ scannedOrgs: 0, linkedGoals: 0 });
    expect(linker.linkGoalTasks).not.toHaveBeenCalled();
  });

  it('пропускает Org с выключенным тумблером (gate throw)', async () => {
    const { cron, prisma, linker, gate } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    gate.checkOrThrow.mockRejectedValue(new Error('disabled'));

    const summary = await cron.scanAllOrgs();

    expect(summary.scannedOrgs).toBe(0);
    expect(prisma.goal.findMany).not.toHaveBeenCalled();
    expect(linker.linkGoalTasks).not.toHaveBeenCalled();
  });

  it('дёргает линкер на свежих AI-целях активной Org', async () => {
    const { cron, prisma, linker } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    prisma.goal.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    linker.linkGoalTasks.mockResolvedValueOnce({ linked: 3 }).mockResolvedValueOnce({ linked: 0 });

    const summary = await cron.scanAllOrgs();

    expect(summary.scannedOrgs).toBe(1);
    expect(summary.linkedGoals).toBe(1);
    expect(linker.linkGoalTasks).toHaveBeenCalledTimes(2);
    expect(linker.linkGoalTasks).toHaveBeenCalledWith('org-1', 'g1');
  });

  it('фильтрует цели по source=ai + lookback (createdAt gte)', async () => {
    const { cron, prisma } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);

    await cron.scanAllOrgs();

    const whereArg = prisma.goal.findMany.mock.calls[0]?.[0]?.where;
    expect(whereArg).toEqual(
      expect.objectContaining({
        tenantId: 'org-1',
        source: 'ai',
        sourceBlockIds: { isEmpty: false },
        createdAt: expect.objectContaining({ gte: expect.any(Date) }),
      }),
    );
  });
});
