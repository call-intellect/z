import { describe, expect, it, vi } from 'vitest';

import { ProactiveWatcherService } from './proactive-watcher.service';

describe('ProactiveWatcherService', () => {
  const allRulesEnabled = {
    insightNoMitigation: true,
    experimentRunningTooLong: true,
    processStaleReview: true,
    roleLowCompleteness: true,
    departmentNoDomain: true,
    insightsSiloedInDomain: true,
    planItemOverdue: true,
  };

  function buildSvc(opts: {
    rules?: Partial<typeof allRulesEnabled>;
    membershipUserId?: string | null;
    dedupReturns?: boolean[];
    morningCheckIns?: Array<{
      id: string;
      personId: string;
      dateLocal: string;
      createdAt: Date;
      plansJson: unknown;
      person: { userId: string | null; name: string | null; timezone: string | null };
    }>;
    eveningDoneCount?: number;
    eveningPlanCheckEnabled?: boolean;
    planItemOverdueThresholdDays?: number;
    eveningLocalHour?: number;
  }) {
    const insightsMany = vi.fn().mockResolvedValue([]);
    const experimentsMany = vi.fn().mockResolvedValue([]);
    const processesMany = vi.fn().mockResolvedValue([]);
    const rolesMany = vi.fn().mockResolvedValue([]);
    const departmentsMany = vi.fn().mockResolvedValue([]);
    const functionalDomainsMany = vi.fn().mockResolvedValue([]);
    const insightCount = vi.fn().mockResolvedValue(0);
    const dailyCheckInMany = vi.fn().mockResolvedValue(opts.morningCheckIns ?? []);
    const dailyCheckInCount = vi.fn().mockResolvedValue(opts.eveningDoneCount ?? 0);
    const proactiveCreate = vi
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `pn-${Math.random()}`, ...data }),
      );
    const proactiveUpdate = vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id }),
      );

    const prisma = {
      org: {
        findMany: vi.fn().mockResolvedValue([{ id: 't1' }]),
      },
      insight: { findMany: insightsMany, count: insightCount },
      experiment: { findMany: experimentsMany },
      process: { findMany: processesMany },
      role: { findMany: rolesMany },
      department: { findMany: departmentsMany },
      functionalDomain: { findMany: functionalDomainsMany },
      dailyCheckIn: {
        findMany: dailyCheckInMany,
        count: dailyCheckInCount,
      },
      proactiveNotification: {
        create: proactiveCreate,
        update: proactiveUpdate,
      },
      membership: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            opts.membershipUserId === undefined
              ? { userId: 'u-admin' }
              : opts.membershipUserId === null
                ? null
                : { userId: opts.membershipUserId },
          ),
      },
    };

    const cfg = {
      proactive: {
        enabled: true,
        antiSpamTtlHours: 24,
        eveningPlanCheckEnabled: opts.eveningPlanCheckEnabled ?? true,
        planItemOverdueThresholdDays: opts.planItemOverdueThresholdDays ?? 1,
        rules: { ...allRulesEnabled, ...(opts.rules ?? {}) },
      },
      betaOps: {
        eveningLocalHour: opts.eveningLocalHour ?? 18,
      },
    };

    const sendNotification = vi.fn().mockResolvedValue({ id: 'notif-1' });

    let dedupCallIdx = 0;
    const dedup = {
      acquire: vi.fn().mockImplementation(() => {
        const arr = opts.dedupReturns;
        if (!arr) return Promise.resolve(true);
        const v = arr[Math.min(dedupCallIdx, arr.length - 1)] ?? true;
        dedupCallIdx++;
        return Promise.resolve(v);
      }),
    };

    const craft = {
      craft: vi.fn().mockResolvedValue({
        title: 'Заголовок',
        body: 'Тело',
        fromLlm: false,
      }),
    };

    const metrics = {
      incProactiveEmitted: vi.fn(),
      incProactiveDismissed: vi.fn(),
      incProactiveDedupSkipped: vi.fn(),
      observeProactiveRuleDuration: vi.fn(),
    };

    const svc = new ProactiveWatcherService(
      prisma as never,
      cfg as never,
      { sendNotification } as never,
      dedup as never,
      craft as never,
      metrics as never,
    );
    return {
      svc,
      prisma,
      sendNotification,
      dedup,
      craft,
      metrics,
      proactiveCreate,
      proactiveUpdate,
      dailyCheckInMany,
      dailyCheckInCount,
    };
  }

  function buildMorningCheckIn(over?: {
    plansJson?: unknown;
    timezone?: string | null;
    dateLocal?: string;
    createdAt?: Date;
  }) {
    return {
      id: 'm1',
      personId: 'p1',
      dateLocal: over?.dateLocal ?? '2026-05-23',
      createdAt: over?.createdAt ?? new Date('2026-05-23T06:00:00Z'),
      plansJson:
        over?.plansJson ??
        ([
          { text: 'Созвон с клиентом', priority: 1 },
          { text: 'Отправить КП', priority: 2 },
        ] as unknown),
      person: {
        userId: 'u-emp',
        name: 'Иван',
        timezone: over?.timezone ?? 'Europe/Moscow',
      },
    };
  }

  const onlyPlanRule = {
    insightNoMitigation: false,
    experimentRunningTooLong: false,
    processStaleReview: false,
    roleLowCompleteness: false,
    departmentNoDomain: false,
    insightsSiloedInDomain: false,
    planItemOverdue: true,
  };

  it('правило disabled → не выполняется (rulesSkippedDisabled++)', async () => {
    const { svc, sendNotification } = buildSvc({
      rules: {
        insightNoMitigation: false,
        experimentRunningTooLong: false,
        processStaleReview: false,
        roleLowCompleteness: false,
        departmentNoDomain: false,
        insightsSiloedInDomain: false,
        planItemOverdue: false,
      },
    });
    const stats = await svc.runOnce(new Date());
    expect(stats.rulesExecuted).toBe(0);
    expect(stats.rulesSkippedDisabled).toBe(7);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('plan_item_overdue: вечер (localHour 21 ≥ 18), нет вечернего → emit с названиями пунктов', async () => {
    const now = new Date('2026-05-23T18:00:00Z');
    const { svc, sendNotification, craft } = buildSvc({
      rules: onlyPlanRule,
      morningCheckIns: [buildMorningCheckIn()],
      eveningDoneCount: 0,
    });
    const stats = await svc.runOnce(now);
    expect(stats.notificationsSent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(craft.craft).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleType: 'plan_item_overdue',
        facts: expect.objectContaining({
          planItems: ['Созвон с клиентом', 'Отправить КП'],
          name: expect.stringContaining('Созвон с клиентом'),
        }),
      }),
    );
  });

  it('plan_item_overdue: день (localHour 10 < 18) → НЕ emit (ещё не вечер)', async () => {
    const now = new Date('2026-05-23T07:00:00Z');
    const { svc, sendNotification, dailyCheckInCount } = buildSvc({
      rules: onlyPlanRule,
      morningCheckIns: [buildMorningCheckIn()],
      eveningDoneCount: 0,
    });
    const stats = await svc.runOnce(now);
    expect(stats.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(dailyCheckInCount).not.toHaveBeenCalled();
  });

  it('plan_item_overdue: вечерний checkIn есть → НЕ emit', async () => {
    const now = new Date('2026-05-23T18:00:00Z');
    const { svc, sendNotification } = buildSvc({
      rules: onlyPlanRule,
      morningCheckIns: [buildMorningCheckIn()],
      eveningDoneCount: 1,
    });
    const stats = await svc.runOnce(now);
    expect(stats.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('plan_item_overdue: eveningPlanCheckEnabled=false → сразу 0, без запросов', async () => {
    const now = new Date('2026-05-23T18:00:00Z');
    const { svc, sendNotification, dailyCheckInMany } = buildSvc({
      rules: onlyPlanRule,
      morningCheckIns: [buildMorningCheckIn()],
      eveningPlanCheckEnabled: false,
    });
    const stats = await svc.runOnce(now);
    expect(stats.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(dailyCheckInMany).not.toHaveBeenCalled();
  });
});
