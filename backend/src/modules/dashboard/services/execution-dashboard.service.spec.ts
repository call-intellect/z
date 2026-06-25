import { describe, expect, it, vi } from 'vitest';

import {
  ExecutionDashboardService,
  aggregateWeeklyMetrics,
  buildGoalVectorReasons,
  buildGoalVectorRows,
  computeDeltas,
  directionFromNet,
  type GoalVectorPersonAggregate,
} from './execution-dashboard.service';

describe('directionFromNet', () => {
  it('net > 0.5 → up', () => {
    expect(directionFromNet(1.2)).toBe('up');
    expect(directionFromNet(0.51)).toBe('up');
  });

  it('net < -0.5 → down', () => {
    expect(directionFromNet(-0.9)).toBe('down');
    expect(directionFromNet(-0.51)).toBe('down');
  });

  it('|net| <= 0.5 → side', () => {
    expect(directionFromNet(0)).toBe('side');
    expect(directionFromNet(0.5)).toBe('side');
    expect(directionFromNet(-0.5)).toBe('side');
  });
});

describe('buildGoalVectorRows', () => {
  it('три человека с net +1.2 / 0.0 / -0.9 → up/side/down и сортировка по netScore desc', () => {
    const people: GoalVectorPersonAggregate[] = [
      {
        personId: 'p-side',
        personName: 'Сайдов',
        netScore: 0,
        proScore: 1,
        contraScore: 1,
        tasksDone: 1,
        tasksOpen: 2,
        reasons: [],
      },
      {
        personId: 'p-down',
        personName: 'Даунов',
        netScore: -0.9,
        proScore: 0.1,
        contraScore: 1,
        tasksDone: 0,
        tasksOpen: 3,
        reasons: [],
      },
      {
        personId: 'p-up',
        personName: 'Апов',
        netScore: 1.2,
        proScore: 1.2,
        contraScore: 0,
        tasksDone: 4,
        tasksOpen: 1,
        reasons: [],
      },
    ];

    const rows = buildGoalVectorRows(people);

    expect(rows.map((r) => r.personId)).toEqual(['p-up', 'p-side', 'p-down']);
    expect(rows.map((r) => r.direction)).toEqual(['up', 'side', 'down']);
    expect(rows[0]!.netScore).toBe(1.2);
    expect(rows[2]!.netScore).toBe(-0.9);
  });

  it('пустой вход → пустой массив', () => {
    expect(buildGoalVectorRows([])).toEqual([]);
  });
});

describe('computeDeltas', () => {
  it('оба периода есть → дельты числовых ключей', () => {
    const current = { greenShare: 0.75, redShare: 0.1, totalCheckIns: 12 };
    const previous = { greenShare: 0.5, redShare: 0.25, totalCheckIns: 8 };
    const deltas = computeDeltas(current, previous);
    expect(deltas.greenShare).toBeCloseTo(0.25);
    expect(deltas.redShare).toBeCloseTo(-0.15);
    expect(deltas.totalCheckIns).toBe(4);
  });

  it('previous = null → пустые дельты', () => {
    expect(computeDeltas({ greenShare: 0.75 }, null)).toEqual({});
  });

  it('current = null → пустые дельты', () => {
    expect(computeDeltas(null, { greenShare: 0.5 })).toEqual({});
  });

  it('ключ только в current → пропущен; нечисловой → пропущен', () => {
    const current = { greenShare: 0.75, topBlockers: ['a', 'b'], onlyHere: 3 };
    const previous = { greenShare: 0.5, topBlockers: ['c'] };
    const deltas = computeDeltas(current, previous);
    expect(Object.keys(deltas)).toEqual(['greenShare']);
    expect(deltas.greenShare).toBeCloseTo(0.25);
  });
});

describe('aggregateWeeklyMetrics', () => {
  it('несколько недель: *Share усредняются, счётчики суммируются, нечисловые пропускаются', () => {
    const weeks = [
      { greenShare: 0.6, redShare: 0.2, totalCheckIns: 10, topBlockers: ['a'] },
      { greenShare: 0.8, redShare: 0.4, totalCheckIns: 14, topBlockers: ['b'] },
    ];
    const agg = aggregateWeeklyMetrics(weeks);
    expect(agg.greenShare).toBeCloseTo(0.7);
    expect(agg.redShare).toBeCloseTo(0.3);
    expect(agg.totalCheckIns).toBe(24);
    expect('topBlockers' in agg).toBe(false);
  });

  it('пустой список недель → пустой объект', () => {
    expect(aggregateWeeklyMetrics([])).toEqual({});
  });
});

describe('buildGoalVectorReasons', () => {
  it('частоты по kind+direction → топ-3 читаемых строк по убыванию', () => {
    const reasons = buildGoalVectorReasons([
      { kind: 'commitment_broken', direction: 'contra', refId: 'a' },
      { kind: 'commitment_broken', direction: 'contra', refId: 'b' },
      { kind: 'commitment_broken', direction: 'contra', refId: 'c' },
      { kind: 'issue_closed', direction: 'pro', refId: 'd' },
    ]);
    expect(reasons[0]).toBe('сорванные обязательства ×3');
    expect(reasons).toContain('закрытые задачи ×1');
  });

  it('нет сигналов → пустой массив', () => {
    expect(buildGoalVectorReasons([])).toEqual([]);
  });
});

describe('ExecutionDashboardService.getGoalVectorByPerson — reasons (D1)', () => {
  function makeService(prisma: unknown, cfg: unknown): ExecutionDashboardService {
    return new ExecutionDashboardService(prisma as never, cfg as never);
  }

  const baseCfg = { getDynamic: vi.fn() };

  it('signalsJson с commitment_broken ×3 (contra) и issue_closed ×1 (pro) → reasons первым «сорванные обязательства ×3»', async () => {
    const prisma = {
      goal: { findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: 'Цель' }) },
      personGoalContribution: {
        findMany: vi.fn().mockResolvedValue([
          {
            personId: 'person-1',
            proScore: { toString: () => '0.3' },
            contraScore: { toString: () => '1.0' },
            netScore: { toString: () => '-0.7' },
            signalsJson: {
              signals: [
                { kind: 'commitment_broken', direction: 'contra', refId: 'r1' },
                { kind: 'commitment_broken', direction: 'contra', refId: 'r2' },
                { kind: 'commitment_broken', direction: 'contra', refId: 'r3' },
                { kind: 'issue_closed', direction: 'pro', refId: 'r4' },
              ],
            },
          },
        ]),
      },
      issueAssignee: { findMany: vi.fn().mockResolvedValue([]) },
      person: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'person-1', name: 'Иванов', userId: 'u1' }]),
      },
    };

    const svc = makeService(prisma, baseCfg);
    const res = await svc.getGoalVectorByPerson({
      tenantId: 't1',
      goalId: 'g1',
      period: 'week',
      now: new Date('2026-06-22T00:00:00Z'),
    });

    const row = res.rows.find((r) => r.personId === 'person-1');
    expect(row).toBeDefined();
    expect(row!.reasons[0]).toBe('сорванные обязательства ×3');
    expect(row!.reasons).toContain('закрытые задачи ×1');
  });

  it('пустой signalsJson → reasons []', async () => {
    const prisma = {
      goal: { findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: 'Цель' }) },
      personGoalContribution: {
        findMany: vi.fn().mockResolvedValue([
          {
            personId: 'person-1',
            proScore: { toString: () => '0.0' },
            contraScore: { toString: () => '0.0' },
            netScore: { toString: () => '0.0' },
            signalsJson: { signals: [] },
          },
        ]),
      },
      issueAssignee: { findMany: vi.fn().mockResolvedValue([]) },
      person: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'person-1', name: 'Иванов', userId: 'u1' }]),
      },
    };

    const svc = makeService(prisma, baseCfg);
    const res = await svc.getGoalVectorByPerson({
      tenantId: 't1',
      goalId: 'g1',
      period: 'week',
      now: new Date('2026-06-22T00:00:00Z'),
    });

    const row = res.rows.find((r) => r.personId === 'person-1');
    expect(row).toBeDefined();
    expect(row!.reasons).toEqual([]);
  });
});

describe('ExecutionDashboardService.getStuckCrossProject (D2)', () => {
  const now = new Date('2026-06-22T00:00:00Z');
  const day = 86_400_000;

  function makeService(prisma: unknown): ExecutionDashboardService {
    const cfg = { getDynamic: vi.fn().mockResolvedValue(5) };
    return new ExecutionDashboardService(prisma as never, cfg as never);
  }

  it('задача с последней активностью старше порога → в stuck; свежая → нет; без активности (старый createdAt) → в stuck', async () => {
    const oldActivity = new Date(now.getTime() - 10 * day);
    const freshActivity = new Date(now.getTime() - 1 * day);
    const oldCreated = new Date(now.getTime() - 20 * day);

    const prisma = {
      issue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'i-stale',
            identifier: 'PROJ-1',
            title: 'Зависшая',
            createdAt: new Date(now.getTime() - 30 * day),
            projectId: 'p1',
            project: { name: 'Проект А' },
          },
          {
            id: 'i-fresh',
            identifier: 'PROJ-2',
            title: 'Свежая',
            createdAt: new Date(now.getTime() - 30 * day),
            projectId: 'p1',
            project: { name: 'Проект А' },
          },
          {
            id: 'i-noactivity',
            identifier: 'PROJ-3',
            title: 'Без активности',
            createdAt: oldCreated,
            projectId: 'p2',
            project: { name: 'Проект Б' },
          },
        ]),
      },
      issueActivity: {
        groupBy: vi.fn().mockResolvedValue([
          { issueId: 'i-stale', _max: { createdAt: oldActivity } },
          { issueId: 'i-fresh', _max: { createdAt: freshActivity } },
        ]),
      },
    };

    const svc = makeService(prisma);
    const res = await svc.getStuckCrossProject({ tenantId: 't1', now });

    const ids = res.items.map((i) => i.issueId);
    expect(ids).toContain('i-stale');
    expect(ids).toContain('i-noactivity');
    expect(ids).not.toContain('i-fresh');
    expect(res.staleDaysThreshold).toBe(5);

    const noActivity = res.items.find((i) => i.issueId === 'i-noactivity');
    expect(noActivity).toEqual(
      expect.objectContaining({ projectName: 'Проект Б', daysStuck: 20 }),
    );
    expect(res.items[0]!.daysStuck).toBeGreaterThanOrEqual(res.items[res.items.length - 1]!.daysStuck);
  });

  it('нет задач → пустой items с порогом', async () => {
    const prisma = {
      issue: { findMany: vi.fn().mockResolvedValue([]) },
      issueActivity: { groupBy: vi.fn() },
    };
    const svc = makeService(prisma);
    const res = await svc.getStuckCrossProject({ tenantId: 't1', now });
    expect(res.items).toEqual([]);
    expect(res.staleDaysThreshold).toBe(5);
  });
});

describe('ExecutionDashboardService.getGoalVectorByPerson — goalState fallback (Ф1)', () => {
  const cfg = { getDynamic: vi.fn() };
  const now = new Date('2026-06-22T00:00:00Z');

  function makeService(prisma: unknown): ExecutionDashboardService {
    return new ExecutionDashboardService(prisma as never, cfg as never);
  }

  type GoalFindFirstArgs = { where?: Record<string, unknown> };

  it('нет primary, нет вкладов, есть active-цель → goalState active_fallback', async () => {
    const prisma = {
      goal: {
        findFirst: vi.fn().mockImplementation((args: GoalFindFirstArgs) => {
          const where = args.where ?? {};
          if (where.isPrimary === true) return Promise.resolve(null);
          if (where.status === 'active') return Promise.resolve({ id: 'g-active' });
          if (where.id !== undefined) {
            return Promise.resolve({
              id: 'g-active',
              name: 'Запустить 10 компаний',
              isPrimary: false,
            });
          }
          return Promise.resolve(null);
        }),
      },
      personGoalContribution: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      issueAssignee: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const svc = makeService(prisma);
    const res = await svc.getGoalVectorByPerson({
      tenantId: 't1',
      period: 'day',
      now,
    });

    expect(res.goalId).toBe('g-active');
    expect(res.goalState).toBe('active_fallback');
    expect(res.rows).toEqual([]);
    expect(res.goalTitle).toBe('Запустить 10 компаний');
  });

  it('нет целей вовсе → goalState none', async () => {
    const prisma = {
      goal: {
        findFirst: vi.fn().mockImplementation((args: GoalFindFirstArgs) => {
          const where = args.where ?? {};
          if (where.isPrimary === true) return Promise.resolve(null);
          if (where.status === 'active') return Promise.resolve(null);
          return Promise.resolve(null);
        }),
      },
      personGoalContribution: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      issueAssignee: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const svc = makeService(prisma);
    const res = await svc.getGoalVectorByPerson({
      tenantId: 't1',
      period: 'day',
      now,
    });

    expect(res.goalId).toBeNull();
    expect(res.goalState).toBe('none');
    expect(res.rows).toEqual([]);
    expect(res.goalTitle).toBeNull();
  });

  it('есть primary-цель → goalState primary', async () => {
    const prisma = {
      goal: {
        findFirst: vi.fn().mockImplementation((args: GoalFindFirstArgs) => {
          const where = args.where ?? {};
          if (where.isPrimary === true) return Promise.resolve({ id: 'g1' });
          if (where.id !== undefined) {
            return Promise.resolve({ id: 'g1', name: 'Главная', isPrimary: true });
          }
          return Promise.resolve(null);
        }),
      },
      personGoalContribution: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      issueAssignee: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const svc = makeService(prisma);
    const res = await svc.getGoalVectorByPerson({
      tenantId: 't1',
      period: 'day',
      now,
    });

    expect(res.goalState).toBe('primary');
    expect(res.goalId).toBe('g1');
  });
});
