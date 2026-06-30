import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { GoalKrProgressService, type ActiveGoalRow } from './goal-kr-progress.service';

type Fn = ReturnType<typeof vi.fn>;

function firstArg<T>(fn: Fn): T {
  const calls = fn.mock.calls as unknown as unknown[][];
  return calls[0]![0] as T;
}

interface PrismaStub {
  goal: { findMany: Fn; update: Fn };
  goalKeyResult: { findMany: Fn; update: Fn };
  goalKeyResultCheckpoint: { create: Fn; findFirst: Fn };
  meeting: { count: Fn };
  issue: { count: Fn };
  entity: { findFirst: Fn };
  $transaction: Fn;
}

function makePrisma(over: Partial<PrismaStub> = {}): {
  prisma: PrismaStub;
  krUpdate: Fn;
  checkpointCreate: Fn;
  goalUpdate: Fn;
} {
  const krUpdate = vi.fn(async () => ({ id: 'kr1' }));
  const checkpointCreate = vi.fn(async () => ({ id: 'cp1' }));
  const goalUpdate = vi.fn(async () => ({ id: 'g1' }));
  const prisma: PrismaStub = {
    goal: { findMany: vi.fn(async () => []), update: goalUpdate },
    goalKeyResult: { findMany: vi.fn(async () => []), update: krUpdate },
    goalKeyResultCheckpoint: {
      create: checkpointCreate,
      findFirst: vi.fn(async () => null),
    },
    meeting: { count: vi.fn(async () => 0) },
    issue: { count: vi.fn(async () => 0) },
    entity: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        goalKeyResult: { update: krUpdate },
        goalKeyResultCheckpoint: { create: checkpointCreate },
      }),
    ),
    ...over,
  };
  return { prisma, krUpdate, checkpointCreate, goalUpdate };
}

function makeMetrics(): { metrics: BusinessMetricsService; inc: Fn } {
  const inc = vi.fn();
  const metrics = {
    incGoalKrAutoprogress: inc,
  } as unknown as BusinessMetricsService;
  return { metrics, inc };
}

function makeService(prisma: PrismaStub): {
  svc: GoalKrProgressService;
  inc: Fn;
} {
  const { metrics, inc } = makeMetrics();
  const cfg = {
    getDynamic: vi.fn(async (_k: string, _e: unknown, fallback: unknown) => fallback),
  } as unknown as TypedConfigService;
  const svc = new GoalKrProgressService(prisma as unknown as PrismaService, metrics, cfg);
  return { svc, inc };
}

const GOAL: ActiveGoalRow = {
  id: 'g1',
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
  targetDate: null,
  progressStatus: 'on_track',
  manualOverride: {},
};

function krRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'kr1',
    sourceKind: 'meeting_count',
    sourceConfig: {},
    manualOverride: {},
    startValue: '0',
    targetValue: '100',
    currentValue: '0',
    ...over,
  };
}

describe('GoalKrProgressService.processGoalKr — computeKrValue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('meeting_count: пишет currentValue из meeting.count + checkpoint(auto) при изменении', async () => {
    const { prisma, checkpointCreate, krUpdate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [krRow({ sourceKind: 'meeting_count' })]),
        update: vi.fn(),
      },
      meeting: { count: vi.fn(async () => 17) },
    });
    const { svc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsUpdated).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(krUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'kr1' } }));
    expect(checkpointCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          keyResultId: 'kr1',
          recordedBy: 'auto',
        }),
      }),
    );
    expect(prisma.meeting.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          status: 'completed',
          deletedAt: null,
        }),
      }),
    );
  });

  it('meeting_count: sourceConfig {meetingType, since} → передаёт type и endedAt.gte', async () => {
    const countMock = vi.fn(async () => 5);
    const { prisma } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [
          krRow({
            sourceKind: 'meeting_count',
            sourceConfig: {
              meetingType: 'sales',
              since: '2026-05-01T00:00:00.000Z',
            },
          }),
        ]),
        update: vi.fn(),
      },
      meeting: { count: countMock },
    });
    const { svc } = makeService(prisma);

    await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    const arg = firstArg<{
      where: { type?: string; endedAt?: { gte: Date } };
    }>(countMock);
    expect(arg.where.type).toBe('sales');
    expect(arg.where.endedAt?.gte).toBeInstanceOf(Date);
  });

  it('issue_rollup: completed Issue.count по goalId → checkpoint', async () => {
    const { prisma, checkpointCreate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [krRow({ sourceKind: 'issue_rollup' })]),
        update: vi.fn(),
      },
      issue: { count: vi.fn(async () => 9) },
    });
    const { svc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsUpdated).toBe(1);
    expect(prisma.issue.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          goalId: 'g1',
          deletedAt: null,
          state: { category: 'completed' },
        }),
      }),
    );
    expect(checkpointCreate).toHaveBeenCalledTimes(1);
  });

  it('metric_entity: берёт Entity.mentionsCount по sourceConfig.entityId', async () => {
    const { prisma, checkpointCreate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [
          krRow({
            sourceKind: 'metric_entity',
            sourceConfig: { entityId: 'ent1' },
          }),
        ]),
        update: vi.fn(),
      },
      entity: { findFirst: vi.fn(async () => ({ mentionsCount: 42 })) },
    });
    const { svc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsUpdated).toBe(1);
    expect(prisma.entity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ent1', tenantId: 't1' },
      }),
    );
    expect(checkpointCreate).toHaveBeenCalledTimes(1);
  });

  it('metric_entity без entityId → skip (нет checkpoint, status=skipped)', async () => {
    const { prisma, checkpointCreate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [krRow({ sourceKind: 'metric_entity', sourceConfig: {} })]),
        update: vi.fn(),
      },
    });
    const { svc, inc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsUpdated).toBe(0);
    expect(res.krsSkipped).toBe(1);
    expect(checkpointCreate).not.toHaveBeenCalled();
    expect(inc).toHaveBeenCalledWith('metric_entity', 'skipped');
  });

  it('manual → skip (нет update/checkpoint, status=skipped)', async () => {
    const { prisma, checkpointCreate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [krRow({ sourceKind: 'manual' })]),
        update: vi.fn(),
      },
      meeting: { count: vi.fn(async () => 999) },
    });
    const { svc, inc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsSkipped).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(checkpointCreate).not.toHaveBeenCalled();
    expect(prisma.meeting.count).not.toHaveBeenCalled();
    expect(inc).toHaveBeenCalledWith('manual', 'skipped');
  });

  it('manualOverride.currentValue → skip даже при meeting_count', async () => {
    const { prisma, checkpointCreate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [
          krRow({
            sourceKind: 'meeting_count',
            manualOverride: { currentValue: true },
          }),
        ]),
        update: vi.fn(),
      },
      meeting: { count: vi.fn(async () => 50) },
    });
    const { svc, inc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsSkipped).toBe(1);
    expect(prisma.meeting.count).not.toHaveBeenCalled();
    expect(checkpointCreate).not.toHaveBeenCalled();
    expect(inc).toHaveBeenCalledWith('meeting_count', 'skipped');
  });

  it('newValue == currentValue → no-op (нет checkpoint, status=unchanged)', async () => {
    const { prisma, checkpointCreate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => [krRow({ sourceKind: 'meeting_count', currentValue: '17' })]),
        update: vi.fn(),
      },
      meeting: { count: vi.fn(async () => 17) },
    });
    const { svc, inc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.krsUpdated).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(checkpointCreate).not.toHaveBeenCalled();
    expect(inc).toHaveBeenCalledWith('meeting_count', 'unchanged');
  });
});

describe('GoalKrProgressService.computeStatus (pure)', () => {
  const base = {
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    now: new Date('2026-05-15T00:00:00.000Z'),
  };

  it('avgProgress >= 100 → achieved', () => {
    const status = GoalKrProgressService.computeStatus({
      ...base,
      targetDate: new Date('2026-08-01T00:00:00.000Z'),
      krs: [{ start: 0, target: 100, current: 100, baseline: 50 }],
      atRiskMargin: 25,
    });
    expect(status).toBe('achieved');
  });

  it('goalDelta <= 0 (нет движения за окно) → stalled', () => {
    const status = GoalKrProgressService.computeStatus({
      ...base,
      targetDate: new Date('2026-08-01T00:00:00.000Z'),
      krs: [{ start: 0, target: 100, current: 30, baseline: 30 }],
      atRiskMargin: 25,
    });
    expect(status).toBe('stalled');
  });

  it('движение есть + отставание от темпа → at_risk', () => {
    const status = GoalKrProgressService.computeStatus({
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      now: new Date('2026-05-15T00:00:00.000Z'),
      targetDate: new Date('2026-05-29T00:00:00.000Z'),
      krs: [{ start: 0, target: 100, current: 10, baseline: 2 }],
      atRiskMargin: 25,
    });
    expect(status).toBe('at_risk');
  });

  it('движение есть + в темпе → on_track', () => {
    const status = GoalKrProgressService.computeStatus({
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      now: new Date('2026-05-15T00:00:00.000Z'),
      targetDate: new Date('2026-05-29T00:00:00.000Z'),
      krs: [{ start: 0, target: 100, current: 60, baseline: 40 }],
      atRiskMargin: 25,
    });
    expect(status).toBe('on_track');
  });

  it('движение есть, targetDate нет → on_track (темп не проверяем)', () => {
    const status = GoalKrProgressService.computeStatus({
      ...base,
      targetDate: null,
      krs: [{ start: 0, target: 100, current: 5, baseline: 1 }],
      atRiskMargin: 25,
    });
    expect(status).toBe('on_track');
  });
});

describe('GoalKrProgressService.recomputeProgressStatus (через processGoalKr)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('progressStatus в manualOverride → goal.update не зовётся', async () => {
    const { prisma, goalUpdate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
    });
    const { svc } = makeService(prisma);

    const res = await svc.processGoalKr({
      tenantId: 't1',
      goal: { ...GOAL, manualOverride: { progressStatus: true } },
    });

    expect(res.restatused).toBe(false);
    expect(goalUpdate).not.toHaveBeenCalled();
  });

  it('0 KR → progressStatus не меняется', async () => {
    const { prisma, goalUpdate } = makePrisma({
      goalKeyResult: {
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
    });
    const { svc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.restatused).toBe(false);
    expect(goalUpdate).not.toHaveBeenCalled();
  });

  it('статус изменился (achieved) → goal.update вызван, restatused=true', async () => {
    const krFindMany = vi
      .fn()
      .mockResolvedValueOnce([
        krRow({ sourceKind: 'manual', currentValue: '100', targetValue: '100' }),
      ])
      .mockResolvedValueOnce([
        { id: 'kr1', startValue: '0', targetValue: '100', currentValue: '100' },
      ]);
    const { prisma, goalUpdate } = makePrisma({
      goalKeyResult: { findMany: krFindMany, update: vi.fn() },
    });
    const { svc } = makeService(prisma);

    const res = await svc.processGoalKr({ tenantId: 't1', goal: GOAL });

    expect(res.restatused).toBe(true);
    expect(goalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g1' },
        data: { progressStatus: 'achieved' },
      }),
    );
  });
});
