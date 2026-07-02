import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalThemeLinkerService } from './goal-theme-linker.service';

const TENANT = 'org-1';
const GOAL_ID = 'goal-1';

interface Mocks {
  prisma: {
    goal: { findUnique: ReturnType<typeof vi.fn> };
    themeIdeaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    themeEntity: { findMany: ReturnType<typeof vi.fn> };
    theme: { findMany: ReturnType<typeof vi.fn> };
    goalTheme: { createMany: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  coreQueue: { enqueueStrategicAlignment: ReturnType<typeof vi.fn> };
  metrics: { incGoalThemeAutolink: ReturnType<typeof vi.fn> };
  cfg: {
    goals: {
      themeAutolinkMinWeight: number;
      themeAutolinkLlmEnabled: boolean;
      themeAutolinkKnnMaxDistance: number;
      themeAutolinkKnnTopK: number;
    };
  };
}

function buildService(cfgOverrides: Partial<Mocks['cfg']['goals']> = {}): {
  svc: GoalThemeLinkerService;
  m: Mocks;
} {
  const m: Mocks = {
    prisma: {
      goal: { findUnique: vi.fn() },
      themeIdeaBlock: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      themeEntity: { findMany: vi.fn().mockResolvedValue([]) },
      theme: { findMany: vi.fn().mockResolvedValue([]) },
      goalTheme: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    },
    coreQueue: {
      enqueueStrategicAlignment: vi.fn().mockResolvedValue({ jobId: 'j' }),
    },
    metrics: { incGoalThemeAutolink: vi.fn() },
    cfg: {
      goals: {
        themeAutolinkMinWeight: 0.15,
        themeAutolinkLlmEnabled: false,
        themeAutolinkKnnMaxDistance: 0.45,
        themeAutolinkKnnTopK: 5,
        ...cfgOverrides,
      },
    },
  };

  const svc = new GoalThemeLinkerService(
    m.prisma as never,
    m.coreQueue as never,
    m.metrics as never,
    m.cfg as never,
  );
  return { svc, m };
}

describe('GoalThemeLinkerService.linkGoalThemes', () => {
  let svc: GoalThemeLinkerService;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('(a) провенанс: блоки-источники в теме → linked>0, source=ai, weight, enqueue', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: ['b1', 'b2'],
    });
    m.prisma.themeIdeaBlock.findMany.mockResolvedValue([{ themeId: 't1' }, { themeId: 't1' }]);
    m.prisma.theme.findMany.mockResolvedValue([{ id: 't1' }]);
    m.prisma.goalTheme.createMany.mockResolvedValue({ count: 1 });

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(1);
    expect(res.provenance).toBe(1);
    expect(m.prisma.goalTheme.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            goalId: GOAL_ID,
            themeId: 't1',
            source: 'ai',
            weight: 1,
          }),
        ]),
      }),
    );
    expect(m.coreQueue.enqueueStrategicAlignment).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, goalId: GOAL_ID }),
    );
    expect(m.metrics.incGoalThemeAutolink).toHaveBeenCalledWith({
      method: 'provenance',
    });
  });

  it('(b) ручная цель (sourceBlockIds пустой) → linked=0, enqueue НЕ вызван', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: [],
    });

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.goalTheme.createMany).not.toHaveBeenCalled();
    expect(m.coreQueue.enqueueStrategicAlignment).not.toHaveBeenCalled();
  });

  it('(c) co-mention добавляет тему, которой нет в провенансе', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: ['b1', 'b2'],
    });
    m.prisma.themeIdeaBlock.findMany.mockResolvedValue([]);
    m.prisma.ideaBlockEntity.findMany.mockResolvedValue([{ entityId: 'e1' }, { entityId: 'e2' }]);
    m.prisma.themeEntity.findMany.mockResolvedValue([
      { themeId: 't2', entityId: 'e1' },
      { themeId: 't2', entityId: 'e2' },
    ]);
    m.prisma.theme.findMany.mockResolvedValue([{ id: 't2' }]);
    m.prisma.goalTheme.createMany.mockResolvedValue({ count: 1 });

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.provenance).toBe(0);
    expect(res.comention).toBe(1);
    expect(res.linked).toBe(1);
    expect(m.prisma.goalTheme.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ themeId: 't2', source: 'ai', weight: 1 }),
        ]),
      }),
    );
    expect(m.metrics.incGoalThemeAutolink).toHaveBeenCalledWith({
      method: 'comention',
    });
    expect(m.coreQueue.enqueueStrategicAlignment).toHaveBeenCalled();
  });

  it('(d) weight ниже minWeight → не привязывается, enqueue НЕ вызван', async () => {
    ({ svc, m } = buildService({ themeAutolinkMinWeight: 0.5 }));
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10'],
    });
    m.prisma.themeIdeaBlock.findMany.mockResolvedValue([{ themeId: 't1' }]);
    m.prisma.theme.findMany.mockResolvedValue([{ id: 't1' }]);

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(res.provenance).toBe(0);
    expect(m.prisma.goalTheme.createMany).not.toHaveBeenCalled();
    expect(m.coreQueue.enqueueStrategicAlignment).not.toHaveBeenCalled();
  });

  it("ручная цель (пустой sourceBlockIds) + KNN-темы → GoalTheme source:'ai' + enqueue", async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: [],
    });
    m.prisma.$queryRaw.mockResolvedValue([
      { themeId: 't1', distance: 0.1 },
      { themeId: 't2', distance: 0.2 },
    ]);
    m.prisma.goalTheme.createMany.mockResolvedValue({ count: 2 });

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(2);
    expect(m.prisma.goalTheme.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            goalId: GOAL_ID,
            themeId: 't1',
            source: 'ai',
            weight: expect.any(Number),
          }),
          expect.objectContaining({
            goalId: GOAL_ID,
            themeId: 't2',
            source: 'ai',
            weight: expect.any(Number),
          }),
        ]),
      }),
    );
    expect(m.coreQueue.enqueueStrategicAlignment).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, goalId: GOAL_ID, manual: true }),
    );
  });

  it('ручная цель без embedding (KNN пуст) → 0 тем, без ошибки и без enqueue', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: [],
    });
    m.prisma.$queryRaw.mockResolvedValue([]);

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.goalTheme.createMany).not.toHaveBeenCalled();
    expect(m.coreQueue.enqueueStrategicAlignment).not.toHaveBeenCalled();
  });

  it('KNN-тема за порогом maxDistance отсечена', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: [],
    });
    m.prisma.$queryRaw.mockResolvedValue([{ themeId: 't1', distance: 0.9 }]);

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.goalTheme.createMany).not.toHaveBeenCalled();
    expect(m.coreQueue.enqueueStrategicAlignment).not.toHaveBeenCalled();
  });

  it('чужой tenant → linked=0, без запросов на привязку', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: 'other-org',
      sourceBlockIds: ['b1'],
    });

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.themeIdeaBlock.findMany).not.toHaveBeenCalled();
    expect(m.coreQueue.enqueueStrategicAlignment).not.toHaveBeenCalled();
  });
});
