import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BudgetAlertCron } from './budget-alert.cron';

/**
 * SBA α-10 wave 3 — BudgetAlertCron: triggers, anti-spam, threshold ordering.
 */
describe('BudgetAlertCron', () => {
  const sendNotification = vi.fn(async () => ({}));
  const computeForOrg = vi.fn();
  const update = vi.fn(async () => ({}));
  const findMany = vi.fn();
  const findFirst = vi.fn(async () => ({ userId: 'u1' }));

  const prisma = {
    orgBudgetCap: { findMany, update },
    membership: { findFirst },
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[0];
  const cfg = {
    budget: { alertEnabled: true, alertThresholdPercents: [80, 100] },
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[1];
  const economics = {
    computeForOrg,
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[2];
  const fx = {
    getCurrentUsdRubRate: vi.fn(async () => 90),
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[3];
  const conversational = {
    sendNotification,
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[4];
  const metrics = {
    incBudgetAlertSent: vi.fn(),
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[5];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('триггерит alert при пересечении 80%', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'c1',
        tenantId: 'org-1',
        monthlyCapRub: '10000',
        lastAlertAt: null,
        lastAlertThreshold: null,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 8100 });
    const cron = new BudgetAlertCron(
      prisma,
      cfg,
      economics,
      fx,
      conversational,
      metrics,
    );
    const result = await cron.runOnce();
    expect(result.alertsSent).toBe(1);
    expect(sendNotification).toHaveBeenCalled();
    expect(metrics.incBudgetAlertSent).toHaveBeenCalledWith(80);
  });

  it('не дублирует alert при том же threshold', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'c1',
        tenantId: 'org-1',
        monthlyCapRub: '10000',
        lastAlertAt: new Date(),
        lastAlertThreshold: 80,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 8200 });
    const cron = new BudgetAlertCron(
      prisma,
      cfg,
      economics,
      fx,
      conversational,
      metrics,
    );
    const result = await cron.runOnce();
    expect(result.alertsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('эскалирует до 100% если cost вырос', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'c1',
        tenantId: 'org-1',
        monthlyCapRub: '10000',
        lastAlertAt: new Date(),
        lastAlertThreshold: 80,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 10500 });
    const cron = new BudgetAlertCron(
      prisma,
      cfg,
      economics,
      fx,
      conversational,
      metrics,
    );
    const result = await cron.runOnce();
    expect(result.alertsSent).toBe(1);
    expect(metrics.incBudgetAlertSent).toHaveBeenCalledWith(100);
  });
});
