import { describe, expect, it, vi, beforeEach } from 'vitest';

import { OrgEconomicsCron } from './org-economics.cron';

describe('OrgEconomicsCron', () => {
  const $queryRaw = vi.fn();
  const orgFindMany = vi.fn();
  const aiUsageLogFindMany = vi.fn();
  const capFindUnique = vi.fn();
  const prisma = {
    $queryRaw,
    org: { findMany: orgFindMany },
    aiUsageLog: { findMany: aiUsageLogFindMany },
    orgBudgetCap: { findUnique: capFindUnique },
  } as unknown as ConstructorParameters<typeof OrgEconomicsCron>[0];
  const fx = {
    getCurrentUsdRubRate: vi.fn(async () => 90),
  } as unknown as ConstructorParameters<typeof OrgEconomicsCron>[1];
  const metrics = {
    setOrgBudgetUtilizationPercent: vi.fn(),
    incOrgEconomicsRun: vi.fn(),
  } as unknown as ConstructorParameters<typeof OrgEconomicsCron>[2];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computeForOrg возвращает агрегаты + topTaskTypes', async () => {
    // 30d sum
    $queryRaw.mockResolvedValueOnce([
      { cost_usd: '5.0', cost_rub: '450', calls: 100n },
    ]);
    // mtd sum
    $queryRaw.mockResolvedValueOnce([
      { cost_usd: '3.0', cost_rub: '270', calls: 60n },
    ]);
    // top tasks
    $queryRaw.mockResolvedValueOnce([
      { task_type: 'summary', cost_rub: '300', calls: 50n },
      { task_type: 'chat', cost_rub: '150', calls: 50n },
    ]);
    aiUsageLogFindMany.mockResolvedValueOnce([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    const cron = new OrgEconomicsCron(prisma, fx, metrics);
    const r = await cron.computeForOrg('org-1', 90);
    expect(r.callsCountLast30d).toBe(100);
    expect(r.costRubLast30d).toBeGreaterThan(0);
    expect(r.activeUsersLast30d).toBe(2);
    expect(r.topTaskTypes).toHaveLength(2);
    expect(r.topTaskTypes[0]?.taskType).toBe('summary');
  });

  it('runForAll проходит по orgs и не падает на ошибке одного', async () => {
    orgFindMany.mockResolvedValueOnce([{ id: 'org-1' }, { id: 'org-2' }]);
    // org-1 успешен
    $queryRaw.mockResolvedValueOnce([{ cost_usd: '0', cost_rub: '0', calls: 0n }]);
    $queryRaw.mockResolvedValueOnce([{ cost_usd: '0', cost_rub: '0', calls: 0n }]);
    $queryRaw.mockResolvedValueOnce([]);
    aiUsageLogFindMany.mockResolvedValueOnce([]);
    capFindUnique.mockResolvedValueOnce(null);
    // org-2 — exception
    $queryRaw.mockRejectedValueOnce(new Error('boom'));
    const cron = new OrgEconomicsCron(prisma, fx, metrics);
    const r = await cron.runForAll();
    expect(r.orgsScanned).toBe(2);
    expect(r.orgsUpdated).toBe(1);
  });
});
