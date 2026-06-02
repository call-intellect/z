import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import {
  GoalKrProgressService,
  type GoalKrProgressSummary,
} from '../services/goal-kr-progress.service';

import { GoalKrProgressCron } from './goal-kr-progress.cron';

type Fn = ReturnType<typeof vi.fn>;

/**
 * Goals OKR v2 (Фаза 3) — тесты cron'а + resilience прохода runForAllOrgs.
 */

describe('GoalKrProgressCron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runForAllOrgs делегирует в сервис и не бросает при ошибке', async () => {
    const svc = {
      runForAllOrgs: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as GoalKrProgressService;
    const cron = new GoalKrProgressCron(svc);
    await expect(cron.runForAllOrgs()).resolves.toBeUndefined();
    expect(
      (svc.runForAllOrgs as unknown as Fn),
    ).toHaveBeenCalledTimes(1);
  });

  it('возвращает summary при успехе', async () => {
    const summary: GoalKrProgressSummary = {
      orgsScanned: 2,
      krsUpdated: 3,
      krsSkipped: 1,
      goalsRestatused: 1,
      failures: 0,
    };
    const svc = {
      runForAllOrgs: vi.fn(async () => summary),
    } as unknown as GoalKrProgressService;
    const cron = new GoalKrProgressCron(svc);
    await cron.runForAllOrgs();
    expect((svc.runForAllOrgs as unknown as Fn)).toHaveBeenCalledTimes(1);
  });
});

describe('GoalKrProgressService.runForAllOrgs — resilience', () => {
  beforeEach(() => vi.clearAllMocks());

  it('обходит несколько Org; ошибка одной цели не валит проход', async () => {
    // 2 Org: t1 (две цели, одна падает), t2 (одна цель).
    const goalFindMany = vi
      .fn()
      // listOrgsWithActiveGoals (distinct tenantId)
      .mockResolvedValueOnce([{ tenantId: 't1' }, { tenantId: 't2' }])
      // listActiveGoals('t1')
      .mockResolvedValueOnce([
        {
          id: 'g1',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          targetDate: null,
          progressStatus: 'on_track',
          manualOverride: {},
        },
        {
          id: 'g-bad',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          targetDate: null,
          progressStatus: 'on_track',
          manualOverride: {},
        },
      ])
      // listActiveGoals('t2')
      .mockResolvedValueOnce([
        {
          id: 'g3',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          targetDate: null,
          progressStatus: 'on_track',
          manualOverride: {},
        },
      ]);

    // goalKeyResult.findMany: g1 → manual KR (skip), g-bad → бросает, g3 → 0 KR.
    const krFindMany = vi.fn(async (args: { where: { goalId: string } }) => {
      if (args.where.goalId === 'g-bad') {
        throw new Error('умышленно');
      }
      if (args.where.goalId === 'g1') {
        return [
          {
            id: 'kr1',
            sourceKind: 'manual',
            sourceConfig: {},
            manualOverride: {},
            startValue: '0',
            targetValue: '100',
            currentValue: '0',
          },
        ];
      }
      return [];
    });

    const prisma = {
      goal: { findMany: goalFindMany, update: vi.fn() },
      goalKeyResult: { findMany: krFindMany, update: vi.fn() },
      goalKeyResultCheckpoint: { create: vi.fn(), findFirst: vi.fn() },
      meeting: { count: vi.fn() },
      issue: { count: vi.fn() },
      entity: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaService;

    const metrics = {
      incGoalKrAutoprogress: vi.fn(),
    } as unknown as BusinessMetricsService;

    const svc = new GoalKrProgressService(prisma, metrics);
    const summary = await svc.runForAllOrgs();

    expect(summary.orgsScanned).toBe(2);
    expect(summary.failures).toBe(1); // g-bad
    // g1 → 1 skipped (manual KR); g3 → 0 KR.
    expect(summary.krsSkipped).toBe(1);
    expect(summary.krsUpdated).toBe(0);
  });
});
