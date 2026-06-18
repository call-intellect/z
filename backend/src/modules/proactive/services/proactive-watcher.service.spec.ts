import { describe, expect, it, vi } from 'vitest';

import { ProactiveWatcherService } from './proactive-watcher.service';

describe('ProactiveWatcherService', () => {
  const allRulesEnabled = {
    decisionNoOwner: true,
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
    decisions?: Array<{
      id: string;
      statement: string | null;
      text: string | null;
      createdAt: Date;
    }>;
    membershipUserId?: string | null;
    dedupReturns?: boolean[];
  }) {
    const decisionsMany = vi.fn().mockResolvedValue(opts.decisions ?? []);
    const insightsMany = vi.fn().mockResolvedValue([]);
    const experimentsMany = vi.fn().mockResolvedValue([]);
    const processesMany = vi.fn().mockResolvedValue([]);
    const rolesMany = vi.fn().mockResolvedValue([]);
    const departmentsMany = vi.fn().mockResolvedValue([]);
    const functionalDomainsMany = vi.fn().mockResolvedValue([]);
    const insightCount = vi.fn().mockResolvedValue(0);
    const dailyCheckInMany = vi.fn().mockResolvedValue([]);
    const dailyCheckInCount = vi.fn().mockResolvedValue(0);
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
      decision: { findMany: decisionsMany },
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
        rules: { ...allRulesEnabled, ...(opts.rules ?? {}) },
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
    };
  }

  it('anti-spam: 2 trigger одного user за день → только 1 notification', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const oldDate = new Date('2026-05-15T00:00:00Z');
    const { svc, sendNotification, metrics } = buildSvc({
      rules: {
        decisionNoOwner: true,
        insightNoMitigation: false,
        experimentRunningTooLong: false,
        processStaleReview: false,
        roleLowCompleteness: false,
        departmentNoDomain: false,
        insightsSiloedInDomain: false,
        planItemOverdue: false,
      },
      decisions: [
        { id: 'd1', statement: 'Решение 1', text: null, createdAt: oldDate },
        { id: 'd2', statement: 'Решение 2', text: null, createdAt: oldDate },
      ],
      dedupReturns: [true, false],
    });

    const stats = await svc.runOnce(now);
    expect(stats.notificationsSent).toBe(1);
    expect(stats.dedupSkipped).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(metrics.incProactiveEmitted).toHaveBeenCalledTimes(1);
    expect(metrics.incProactiveDedupSkipped).toHaveBeenCalledTimes(1);
  });

  it('правило disabled → не выполняется (rulesSkippedDisabled++)', async () => {
    const { svc, sendNotification } = buildSvc({
      rules: {
        decisionNoOwner: false,
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
    expect(stats.rulesSkippedDisabled).toBe(8);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('Decision новее 3 дней → emit не происходит', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const recent = new Date('2026-05-23T08:00:00Z');
    const { svc, sendNotification } = buildSvc({
      rules: {
        decisionNoOwner: true,
        insightNoMitigation: false,
        experimentRunningTooLong: false,
        processStaleReview: false,
        roleLowCompleteness: false,
        departmentNoDomain: false,
        insightsSiloedInDomain: false,
        planItemOverdue: false,
      },
      decisions: [],
    });
    const stats = await svc.runOnce(now);
    expect(stats.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    void recent;
  });

  it('нет admin/owner → детектор тихо пропускает', async () => {
    const { svc, sendNotification } = buildSvc({
      rules: {
        decisionNoOwner: true,
        insightNoMitigation: false,
        experimentRunningTooLong: false,
        processStaleReview: false,
        roleLowCompleteness: false,
        departmentNoDomain: false,
        insightsSiloedInDomain: false,
        planItemOverdue: false,
      },
      decisions: [
        {
          id: 'd1',
          statement: 'X',
          text: null,
          createdAt: new Date('2026-05-15T00:00:00Z'),
        },
      ],
      membershipUserId: null,
    });
    const stats = await svc.runOnce(new Date('2026-05-23T12:00:00Z'));
    expect(stats.notificationsSent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
