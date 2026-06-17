import { describe, expect, it, vi } from 'vitest';

import { DailyCheckInPromptCron } from './daily-checkin-prompt.cron';

describe('DailyCheckInPromptCron', () => {
  const baseCfg = {
    betaOps: {
      dailyCheckInEnabled: true,
      morningLocalHour: 9,
      eveningLocalHour: 18,
      operationsDashboardCacheTtlSeconds: 300,
    },
  };

  function buildCron(overrides: {
    persons: Array<{
      id: string;
      tenantId: string;
      userId: string;
      timezone: string | null;
      name: string;
    }>;
    hasCompleted?: boolean;
    cfg?: typeof baseCfg;
  }) {
    const prisma = {
      person: {
        findMany: vi.fn().mockResolvedValue(overrides.persons),
      },
    };
    const checkin = {
      hasCompletedToday: vi.fn().mockResolvedValue(overrides.hasCompleted ?? false),
      createPromptPlaceholder: vi.fn().mockResolvedValue({ id: 'cin1', notificationId: 'n1' }),
    };
    const conversational = {
      sendNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
    };
    const metrics = {
      incDailyCheckinSkipped: vi.fn(),
    };
    const cron = new DailyCheckInPromptCron(
      prisma as never,
      (overrides.cfg ?? baseCfg) as never,
      checkin as never,
      conversational as never,
      metrics as never,
    );
    return { cron, prisma, checkin, conversational, metrics };
  }

  it('Europe/Moscow 9:00 локально (6:00 UTC) → отправляет morning prompt', async () => {
    const { cron, conversational, checkin } = buildCron({
      persons: [
        {
          id: 'p1',
          tenantId: 't1',
          userId: 'u1',
          timezone: 'Europe/Moscow',
          name: 'Анна',
        },
      ],
    });
    const now = new Date('2026-05-23T06:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.promptsSent).toBe(1);
    expect(stats.skippedOutsideWindow).toBe(0);
    expect(conversational.sendNotification).toHaveBeenCalledOnce();
    expect(checkin.createPromptPlaceholder).toHaveBeenCalledOnce();
  });

  it('Уже completed чек-ин → skip + метрика', async () => {
    const { cron, conversational, metrics } = buildCron({
      persons: [
        {
          id: 'p1',
          tenantId: 't1',
          userId: 'u1',
          timezone: 'Europe/Moscow',
          name: 'Анна',
        },
      ],
      hasCompleted: true,
    });
    const now = new Date('2026-05-23T06:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.promptsSent).toBe(0);
    expect(stats.skippedAlreadyCompleted).toBe(1);
    expect(conversational.sendNotification).not.toHaveBeenCalled();
    expect(metrics.incDailyCheckinSkipped).toHaveBeenCalled();
  });

  it('Не время чек-ина (11:00 локально) → skipped_outside_window', async () => {
    const { cron, conversational } = buildCron({
      persons: [
        {
          id: 'p1',
          tenantId: 't1',
          userId: 'u1',
          timezone: 'Europe/Moscow',
          name: 'Анна',
        },
      ],
    });
    const now = new Date('2026-05-23T08:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.promptsSent).toBe(0);
    expect(stats.skippedOutsideWindow).toBe(1);
    expect(conversational.sendNotification).not.toHaveBeenCalled();
  });

  it('Disabled flag — cron run() → ранний выход', async () => {
    const cfg = {
      betaOps: {
        ...baseCfg.betaOps,
        dailyCheckInEnabled: false,
      },
    };
    const { cron, prisma } = buildCron({
      persons: [],
      cfg,
    });
    await cron.run();
    expect(prisma.person.findMany).not.toHaveBeenCalled();
  });

  it('Europe/Moscow 18:00 локально (15:00 UTC) → evening prompt', async () => {
    const { cron, conversational } = buildCron({
      persons: [
        {
          id: 'p1',
          tenantId: 't1',
          userId: 'u1',
          timezone: 'Europe/Moscow',
          name: 'Анна',
        },
      ],
    });
    const now = new Date('2026-05-23T15:00:00Z');
    const stats = await cron.runOnce(now);
    expect(stats.promptsSent).toBe(1);
    const callArg = conversational.sendNotification.mock.calls[0]?.[0] as
      | { payload: { checkInKind: string } }
      | undefined;
    expect(callArg?.payload.checkInKind).toBe('evening');
  });
});
