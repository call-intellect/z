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
    generated?: unknown;
    memberships?: Array<{ userId: string }>;
    cfg?: typeof baseCfg;
  }) {
    const prisma = {
      org: {
        findMany: vi.fn().mockResolvedValue(overrides.orgs),
      },
      membership: {
        findMany: vi
          .fn()
          .mockResolvedValue(overrides.memberships ?? [{ userId: 'u1' }]),
      },
    };
    const digestService = {
      getStored: vi.fn().mockResolvedValue(overrides.existingDigest ?? null),
      getOrGenerate: vi.fn().mockResolvedValue(
        overrides.generated ?? {
          id: 'md1',
          tenantId: 'o1',
          periodYm: '2026-05',
          bodyMarkdown: 'текст',
          metrics: {},
          sources: {},
          llmTaskRouteId: 'deepseek',
          createdAt: '2026-06-01T03:00:00Z',
          deliveredAt: null,
        },
      ),
      markDelivered: vi.fn().mockResolvedValue(undefined),
    };
    const conversational = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      incCooMonthlyDigestFailed: vi.fn(),
      incCooMonthlyDigestGenerated: vi.fn(),
      incCooMonthlyDigestDelivered: vi.fn(),
    };
    const cron = new OperationsMonthlyDigestCron(
      prisma as never,
      (overrides.cfg ?? baseCfg) as never,
      digestService as never,
      conversational as never,
      metrics as never,
    );
    return { cron, prisma, digestService, conversational, metrics };
  }

  it('1-е число 06:00 МСК, org без дайджеста → генерирует и доставляет за 2026-05', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'o1' }],
    });
    const now = new Date('2026-06-01T03:00:00Z');
    const stats = await cron.runOnce(now);

    expect(stats.digestsGenerated).toBe(1);
    expect(stats.notificationsSent).toBe(1);
    expect(stats.skippedOutsideWindow).toBe(0);
    expect(digestService.getOrGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'o1', periodYm: '2026-05' }),
    );
    expect(conversational.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'operations.monthly_digest',
        payload: expect.objectContaining({ actionUrl: '/month' }),
      }),
    );
    expect(digestService.markDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'o1', periodYm: '2026-05' }),
    );
  });

  it('идемпотентность доставки: existing с deliveredAt → не шлёт и не markDelivered', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'o1' }],
      existingDigest: {
        id: 'md-exists',
        periodYm: '2026-05',
        deliveredAt: '2026-06-01T03:05:00Z',
      },
    });
    const now = new Date('2026-06-01T03:00:00Z');
    const stats = await cron.runOnce(now);

    expect(stats.digestsSkippedAlreadyExists).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
    expect(stats.notificationsSent).toBe(0);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
    expect(conversational.sendNotification).not.toHaveBeenCalled();
    expect(digestService.markDelivered).not.toHaveBeenCalled();
  });

  it('повторная доставка: existing без deliveredAt → шлёт и markDelivered, не генерирует', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'o1' }],
      existingDigest: {
        id: 'md-exists',
        periodYm: '2026-05',
        deliveredAt: null,
      },
    });
    const now = new Date('2026-06-01T03:00:00Z');
    const stats = await cron.runOnce(now);

    expect(stats.digestsGenerated).toBe(0);
    expect(stats.notificationsSent).toBe(1);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
    expect(conversational.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'operations.monthly_digest',
        payload: expect.objectContaining({ actionUrl: '/month' }),
      }),
    );
    expect(digestService.markDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'o1', periodYm: '2026-05' }),
    );
  });

  it('2-е число → outside window, Org/доставка не трогаются', async () => {
    const { cron, prisma, digestService, conversational } = buildCron({
      orgs: [{ id: 'o1' }],
    });
    const now = new Date('2026-06-02T03:00:00Z');
    const stats = await cron.runOnce(now);

    expect(stats.skippedOutsideWindow).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
    expect(stats.notificationsSent).toBe(0);
    expect(prisma.org.findMany).not.toHaveBeenCalled();
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
    expect(conversational.sendNotification).not.toHaveBeenCalled();
  });

  it('1-е число, но не 06:00 → outside window', async () => {
    const { cron, prisma, conversational } = buildCron({ orgs: [{ id: 'o1' }] });
    const now = new Date('2026-06-01T05:00:00Z');
    const stats = await cron.runOnce(now);

    expect(stats.skippedOutsideWindow).toBe(1);
    expect(prisma.org.findMany).not.toHaveBeenCalled();
    expect(conversational.sendNotification).not.toHaveBeenCalled();
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
