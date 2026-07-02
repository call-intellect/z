import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalHierarchyRebuildCron } from './goal-hierarchy-rebuild.cron';

interface Mocks {
  prisma: {
    org: { findMany: ReturnType<typeof vi.fn> };
    goal: { findMany: ReturnType<typeof vi.fn> };
  };
  redis: { client: { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } };
  gate: { checkOrThrow: ReturnType<typeof vi.fn> };
  cfg: { getDynamic: ReturnType<typeof vi.fn> };
  specialist: { rebuildParentForGoal: ReturnType<typeof vi.fn> };
}

function buildCron(opts: { enabled?: boolean } = {}): {
  cron: GoalHierarchyRebuildCron;
  m: Mocks;
} {
  const enabled = opts.enabled ?? true;
  const m: Mocks = {
    prisma: {
      org: { findMany: vi.fn().mockResolvedValue([]) },
      goal: { findMany: vi.fn().mockResolvedValue([]) },
    },
    redis: {
      client: {
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
      },
    },
    gate: { checkOrThrow: vi.fn().mockResolvedValue(undefined) },
    cfg: {
      getDynamic: vi.fn(
        async (key: string, _env: string | undefined, fallback: unknown) =>
          key === 'goals.hierarchyRebuild.enabled'
            ? enabled
            : key === 'goals.hierarchyRebuildMinConfidence'
              ? 0.7
              : key === 'goals.hierarchyRebuildPerOrgLimit'
                ? 50
                : fallback,
      ),
    },
    specialist: {
      rebuildParentForGoal: vi
        .fn()
        .mockResolvedValue({ reparented: false, reason: 'no_child_of' }),
    },
  };

  const cron = new GoalHierarchyRebuildCron(
    m.prisma as never,
    m.redis as never,
    m.gate as never,
    m.cfg as never,
    m.specialist as never,
  );
  return { cron, m };
}

describe('GoalHierarchyRebuildCron.sweep', () => {
  let cron: GoalHierarchyRebuildCron;
  let m: Mocks;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kill-switch off: ранний выход, redis.set не вызывается', async () => {
    ({ cron, m } = buildCron({ enabled: false }));

    await cron.sweep();

    expect(m.redis.client.set).not.toHaveBeenCalled();
    expect(m.specialist.rebuildParentForGoal).not.toHaveBeenCalled();
  });

  it('lock busy: runOnce не запускается, lock НЕ удаляется', async () => {
    ({ cron, m } = buildCron());
    m.redis.client.set.mockResolvedValueOnce(null);

    await cron.sweep();

    expect(m.prisma.org.findMany).not.toHaveBeenCalled();
    expect(m.specialist.rebuildParentForGoal).not.toHaveBeenCalled();
    expect(m.redis.client.del).not.toHaveBeenCalled();
  });

  it('lock acquired: runOnce бежит, в finally вызывается redis.del', async () => {
    ({ cron, m } = buildCron());
    m.redis.client.set.mockResolvedValueOnce('OK');

    await cron.sweep();

    expect(m.prisma.org.findMany).toHaveBeenCalledTimes(1);
    expect(m.redis.client.del).toHaveBeenCalledTimes(1);
  });
});

describe('GoalHierarchyRebuildCron.runOnce', () => {
  let cron: GoalHierarchyRebuildCron;
  let m: Mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ cron, m } = buildCron());
  });

  it('1 org проходит gate, 2 цели → summary с reparented:1', async () => {
    m.prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    m.prisma.goal.findMany.mockResolvedValue([{ id: 'g-1' }, { id: 'g-2' }]);
    m.specialist.rebuildParentForGoal
      .mockResolvedValueOnce({ reparented: true, reason: 'reparented' })
      .mockResolvedValueOnce({ reparented: false, reason: 'manual_override' });

    const summary = await cron.runOnce();

    expect(summary).toEqual({
      scannedOrgs: 1,
      goalsScanned: 2,
      reparented: 1,
      errors: 0,
    });
  });

  it('per-org cap: goal.findMany вызван с take = perOrgLimit', async () => {
    m.prisma.org.findMany.mockResolvedValue([{ id: 'org-1' }]);
    m.prisma.goal.findMany.mockResolvedValue([]);

    await cron.runOnce();

    expect(m.prisma.goal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});
