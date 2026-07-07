import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BudgetAlertCron } from './budget-alert.cron';

describe('BudgetAlertCron', () => {
  const sendNotification = vi.fn(async () => ({}));
  const computeForOrg = vi.fn();
  const upsert = vi.fn(async () => ({}));
  const orgBudgetCapFindMany = vi.fn();
  const orgFindMany = vi.fn();
  const findFirst = vi.fn(async () => ({ userId: 'u1' }));
  const getDynamic = vi.fn(async () => 0);

  const prisma = {
    orgBudgetCap: { findMany: orgBudgetCapFindMany, upsert },
    org: { findMany: orgFindMany },
    membership: { findFirst },
  } as unknown as ConstructorParameters<typeof BudgetAlertCron>[0];
  const cfg = {
    budget: { alertEnabled: true, alertThresholdPercents: [80, 100] },
    getDynamic,
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
    getDynamic.mockResolvedValue(0);
    orgFindMany.mockResolvedValue([{ id: 'org-1' }]);
  });

  it('триггерит alert при пересечении 80%', async () => {
    orgBudgetCapFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        tenantId: 'org-1',
        monthlyCapRub: '10000',
        capKind: 'soft',
        alertThresholds: [80, 100],
        lastAlertAt: null,
        lastAlertThreshold: null,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 8100 });
    const cron = new BudgetAlertCron(prisma, cfg, economics, fx, conversational, metrics);
    const result = await cron.runOnce();
    expect(result.alertsSent).toBe(1);
    expect(sendNotification).toHaveBeenCalled();
    expect(metrics.incBudgetAlertSent).toHaveBeenCalledWith(80);
  });

  it('не дублирует alert при том же threshold', async () => {
    orgBudgetCapFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        tenantId: 'org-1',
        monthlyCapRub: '10000',
        capKind: 'soft',
        alertThresholds: [80, 100],
        lastAlertAt: new Date(),
        lastAlertThreshold: 80,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 8200 });
    const cron = new BudgetAlertCron(prisma, cfg, economics, fx, conversational, metrics);
    const result = await cron.runOnce();
    expect(result.alertsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('эскалирует до 100% если cost вырос', async () => {
    orgBudgetCapFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        tenantId: 'org-1',
        monthlyCapRub: '10000',
        capKind: 'soft',
        alertThresholds: [80, 100],
        lastAlertAt: new Date(),
        lastAlertThreshold: 80,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 10500 });
    const cron = new BudgetAlertCron(prisma, cfg, economics, fx, conversational, metrics);
    const result = await cron.runOnce();
    expect(result.alertsSent).toBe(1);
    expect(metrics.incBudgetAlertSent).toHaveBeenCalledWith(100);
  });

  it('Org без строки OrgBudgetCap + платформенный дефолт → alert отправлен, режим остаётся soft, строка создана без суммы', async () => {
    getDynamic.mockResolvedValue(5000);
    orgFindMany.mockResolvedValueOnce([{ id: 'org-2' }]);
    orgBudgetCapFindMany.mockResolvedValueOnce([]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 5200 });
    const cron = new BudgetAlertCron(prisma, cfg, economics, fx, conversational, metrics);
    const result = await cron.runOnce();

    expect(result.alertsSent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const notifyArgs = (sendNotification as any).mock.calls[0][0] as {
      payload: { message: string };
    };
    expect(notifyArgs.payload.message).not.toContain('экономный режим');

    expect(upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = (upsert as any).mock.calls[0][0] as {
      where: { tenantId: string };
      create: { monthlyCapRub: unknown; capKind: string; lastAlertAt: unknown; lastAlertThreshold: unknown };
    };
    expect(upsertArgs.where).toEqual({ tenantId: 'org-2' });
    expect(upsertArgs.create.monthlyCapRub).toBeNull();
    expect(upsertArgs.create.capKind).toBe('soft');
    expect(upsertArgs.create.lastAlertAt).toBeInstanceOf(Date);
    expect(upsertArgs.create.lastAlertThreshold).toBe(100);
  });

  it('Org с explicit capKind=downgrade и utilization>=100% → текст уведомления содержит «экономный режим»', async () => {
    orgFindMany.mockResolvedValueOnce([{ id: 'org-3' }]);
    orgBudgetCapFindMany.mockResolvedValueOnce([
      {
        id: 'c3',
        tenantId: 'org-3',
        monthlyCapRub: '5000',
        capKind: 'downgrade',
        alertThresholds: [80, 100],
        lastAlertAt: null,
        lastAlertThreshold: null,
      },
    ]);
    computeForOrg.mockResolvedValueOnce({ costRubMonthToDate: 5500 });
    const cron = new BudgetAlertCron(prisma, cfg, economics, fx, conversational, metrics);
    const result = await cron.runOnce();

    expect(result.alertsSent).toBe(1);
    const notifyArgs = (sendNotification as any).mock.calls[0][0] as {
      payload: { message: string };
    };
    expect(notifyArgs.payload.message).toContain('экономный режим');
  });

  it('повторный runOnce в тот же месяц с тем же trigger → alertsSent не растёт второй раз (дедуп)', async () => {
    const lastAlertAt = new Date();
    orgFindMany.mockResolvedValue([{ id: 'org-4' }]);
    orgBudgetCapFindMany.mockResolvedValueOnce([
      {
        id: 'c4',
        tenantId: 'org-4',
        monthlyCapRub: '5000',
        capKind: 'downgrade',
        alertThresholds: [80, 100],
        lastAlertAt: null,
        lastAlertThreshold: null,
      },
    ]);
    computeForOrg.mockResolvedValue({ costRubMonthToDate: 5500 });
    const cron = new BudgetAlertCron(prisma, cfg, economics, fx, conversational, metrics);
    const first = await cron.runOnce();
    expect(first.alertsSent).toBe(1);

    orgBudgetCapFindMany.mockResolvedValueOnce([
      {
        id: 'c4',
        tenantId: 'org-4',
        monthlyCapRub: '5000',
        capKind: 'downgrade',
        alertThresholds: [80, 100],
        lastAlertAt,
        lastAlertThreshold: 100,
      },
    ]);
    const second = await cron.runOnce();
    expect(second.alertsSent).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
