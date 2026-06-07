import { describe, expect, it, vi } from 'vitest';

import { GoalThemeLinkerCron } from './goal-theme-linker.cron';

/**
 * Agent-chain overhaul Фаза 4.2 — минимальный smoke cron'а догоночной привязки.
 */
function buildCron() {
  const prisma = {
    org: { findMany: vi.fn().mockResolvedValue([]) },
    goal: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const linker = { linkGoalThemes: vi.fn().mockResolvedValue({ linked: 0 }) };
  const gate = { checkOrThrow: vi.fn().mockResolvedValue(undefined) };
  const cron = new GoalThemeLinkerCron(
    prisma as never,
    linker as never,
    gate as never,
  );
  return { cron, prisma, linker, gate };
}

describe('GoalThemeLinkerCron', () => {
  it('пустой список Org → не падает, ничего не привязывает', async () => {
    const { cron, linker } = buildCron();
    const summary = await cron.scanAllOrgs();
    expect(summary).toEqual({ scannedOrgs: 0, linkedGoals: 0 });
    expect(linker.linkGoalThemes).not.toHaveBeenCalled();
  });

  it('пропускает Org с выключенным тумблером (gate throw)', async () => {
    const { cron, prisma, linker, gate } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    gate.checkOrThrow.mockRejectedValue(new Error('disabled'));

    const summary = await cron.scanAllOrgs();

    expect(summary.scannedOrgs).toBe(0);
    expect(prisma.goal.findMany).not.toHaveBeenCalled();
    expect(linker.linkGoalThemes).not.toHaveBeenCalled();
  });

  it('привязывает AI-цели без тем у активной Org', async () => {
    const { cron, prisma, linker } = buildCron();
    prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    prisma.goal.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    linker.linkGoalThemes
      .mockResolvedValueOnce({ linked: 2 })
      .mockResolvedValueOnce({ linked: 0 });

    const summary = await cron.scanAllOrgs();

    expect(summary.scannedOrgs).toBe(1);
    expect(summary.linkedGoals).toBe(1);
    expect(linker.linkGoalThemes).toHaveBeenCalledTimes(2);
    expect(linker.linkGoalThemes).toHaveBeenCalledWith('org-1', 'g1');
  });
});
