import { describe, expect, it, vi } from 'vitest';

import { OperationsWeeklyDigestCron } from './operations-weekly-digest.cron';

describe('OperationsWeeklyDigestCron', () => {
  const baseCfg = {
    betaOps: {
      weeklyDigestEnabled: true,
      weeklyDigestLocalHour: 8,
      weeklyDigestLocalDay: 1,
    },
  };

  function buildCron(overrides: {
    orgs: Array<{ id: string; timezone: string | null }>;
    existingDigest?: unknown;
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
          .mockResolvedValue(overrides.memberships ?? [{ userId: 'u_coo' }, { userId: 'u_owner' }]),
      },
    };
    const digestService = {
      getStored: vi.fn().mockResolvedValue(overrides.existingDigest ?? null),
      getOrGenerate: vi.fn().mockResolvedValue({
        id: 'wd1',
        tenantId: 'org-1',
        weekStart: '2026-05-18',
        weekEnd: '2026-05-24',
        bodyMarkdown: 'текст',
        metrics: {},
        sources: {},
        llmTaskRouteId: 'deepseek',
        createdAt: '2026-05-25T08:00:00Z',
      }),
    };
    const conversational = {
      sendNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
    };
    const metrics = {
      incCooWeeklyDigestFailed: vi.fn(),
      incCooWeeklyDigestGenerated: vi.fn(),
    };
    const cron = new OperationsWeeklyDigestCron(
      prisma as never,
      (overrides.cfg ?? baseCfg) as never,
      digestService as never,
      conversational as never,
      metrics as never,
    );
    return { cron, prisma, digestService, conversational, metrics };
  }

  it('Europe/Moscow понедельник 08:00 локально (05:00 UTC) → генерирует дайджест и шлёт', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'org-1', timezone: 'Europe/Moscow' }],
    });
    const now = new Date('2026-05-25T05:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsGenerated).toBe(1);
    expect(stats.digestsSkippedOutsideWindow).toBe(0);
    expect(digestService.getOrGenerate).toHaveBeenCalledOnce();
    const arg = digestService.getOrGenerate.mock.calls[0]![0] as {
      tenantId: string;
      weekStart: string;
      weekEnd: string;
    };
    expect(arg.weekStart).toBe('2026-05-18');
    expect(arg.weekEnd).toBe('2026-05-22');
    expect(conversational.sendNotification).toHaveBeenCalledTimes(2);
    expect(stats.notificationsSent).toBe(2);
  });

  it('Среда → outside window, ничего не генерируется', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'org-1', timezone: 'Europe/Moscow' }],
    });
    const now = new Date('2026-05-27T05:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsGenerated).toBe(0);
    expect(stats.digestsSkippedOutsideWindow).toBe(1);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
    expect(conversational.sendNotification).not.toHaveBeenCalled();
  });

  it('Понедельник, но не 8:00 → outside window', async () => {
    const { cron, digestService } = buildCron({
      orgs: [{ id: 'org-1', timezone: 'Europe/Moscow' }],
    });
    const now = new Date('2026-05-25T06:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsGenerated).toBe(0);
    expect(stats.digestsSkippedOutsideWindow).toBe(1);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
  });

  it('Идемпотентность: если дайджест за неделю уже есть — пропускает', async () => {
    const { cron, digestService } = buildCron({
      orgs: [{ id: 'org-1', timezone: 'Europe/Moscow' }],
      existingDigest: {
        id: 'wd-exists',
        tenantId: 'org-1',
        weekStart: '2026-05-18',
        weekEnd: '2026-05-24',
        bodyMarkdown: 'старый',
        metrics: {},
        sources: {},
        llmTaskRouteId: null,
        createdAt: '2026-05-19T08:00:00Z',
      },
    });
    const now = new Date('2026-05-25T05:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsSkippedAlreadyExists).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
  });

  it('COO_WEEKLY_DIGEST_ENABLED=false → no-op', async () => {
    const { cron, prisma } = buildCron({
      orgs: [{ id: 'org-1', timezone: 'Europe/Moscow' }],
      cfg: {
        betaOps: {
          weeklyDigestEnabled: false,
          weeklyDigestLocalHour: 8,
          weeklyDigestLocalDay: 1,
        },
      },
    });
    await cron.run();
    expect(prisma.org.findMany).not.toHaveBeenCalled();
  });

  it('Org с timezone=null → дефолт Europe/Moscow', async () => {
    const { cron, digestService } = buildCron({
      orgs: [{ id: 'org-1', timezone: null }],
    });
    const now = new Date('2026-05-25T05:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.digestsGenerated).toBe(1);
    expect(digestService.getOrGenerate).toHaveBeenCalledOnce();
  });
});
