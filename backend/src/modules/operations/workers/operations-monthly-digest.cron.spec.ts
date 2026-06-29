import { describe, expect, it, vi } from 'vitest';

import { OperationsMonthlyDigestCron } from './operations-monthly-digest.cron';

describe('OperationsMonthlyDigestCron', () => {
  const baseCfg = {
    betaOps: {
      monthlyDigestEnabled: true,
      monthlyDigestLocalHour: 6,
    },
  };

  function buildCron(overrides: {
    orgs: Array<{ id: string }>;
    existingDigest?: unknown;
    cfg?: typeof baseCfg;
  }) {
    const prisma = {
      org: {
        findMany: vi.fn().mockResolvedValue(overrides.orgs),
      },
    };
    const digestService = {
      getStored: vi.fn().mockResolvedValue(overrides.existingDigest ?? null),
      getOrGenerate: vi.fn().mockResolvedValue({
        id: 'md1',
        tenantId: 'o1',
        periodYm: '2026-05',
        bodyMarkdown: 'текст',
        metrics: {},
        sources: {},
        llmTaskRouteId: 'deepseek',
        createdAt: '2026-06-01T03:00:00Z',
      }),
    };
    const metrics = {
      incCooMonthlyDigestFailed: vi.fn(),
      incCooMonthlyDigestGenerated: vi.fn(),
    };
    const cron = new OperationsMonthlyDigestCron(
      prisma as never,
      (overrides.cfg ?? baseCfg) as never,
      digestService as never,
      metrics as never,
    );
    return { cron, prisma, digestService, metrics };
  }

  it('1-е число 06:00 МСК → генерирует за прошлый месяц (2026-05)', async () => {
    const { cron, digestService } = buildCron({ orgs: [{ id: 'o1' }] });
    const now = new Date('2026-06-01T03:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsGenerated).toBe(1);
    expect(stats.skippedOutsideWindow).toBe(0);
    expect(digestService.getOrGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'o1', periodYm: '2026-05' }),
    );
  });

  it('идемпотентность: сводка за месяц уже есть → не генерирует', async () => {
    const { cron, digestService } = buildCron({
      orgs: [{ id: 'o1' }],
      existingDigest: { id: 'md-exists', periodYm: '2026-05' },
    });
    const now = new Date('2026-06-01T03:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsSkippedAlreadyExists).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
  });

  it('2-е число → outside window, Org не обходится', async () => {
    const { cron, prisma, digestService } = buildCron({ orgs: [{ id: 'o1' }] });
    const now = new Date('2026-06-02T03:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.skippedOutsideWindow).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
    expect(prisma.org.findMany).not.toHaveBeenCalled();
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
  });

  it('1-е число, но не 06:00 → outside window', async () => {
    const { cron, prisma } = buildCron({ orgs: [{ id: 'o1' }] });
    const now = new Date('2026-06-01T05:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.skippedOutsideWindow).toBe(1);
    expect(prisma.org.findMany).not.toHaveBeenCalled();
  });

  it('COO_MONTHLY_DIGEST_ENABLED=false → no-op', async () => {
    const { cron, prisma } = buildCron({
      orgs: [{ id: 'o1' }],
      cfg: {
        betaOps: { monthlyDigestEnabled: false, monthlyDigestLocalHour: 6 },
      },
    });
    await cron.run();
    expect(prisma.org.findMany).not.toHaveBeenCalled();
  });
});
