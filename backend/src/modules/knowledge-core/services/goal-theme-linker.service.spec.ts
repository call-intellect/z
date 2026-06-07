import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalThemeLinkerService } from './goal-theme-linker.service';

/**
 * Agent-chain overhaul Фаза 4.2 — unit-тесты GoalThemeLinkerService.
 *
 * Мокаем Prisma / CoreQueue / Metrics / TypedConfig. Покрываем:
 *   (a) провенанс: sourceBlockIds ∩ ThemeIdeaBlock → linked>0, source='ai',
 *       weight корректный, enqueueStrategicAlignment вызван;
 *   (b) ручная цель (sourceBlockIds пустой) → linked=0, enqueue НЕ вызван;
 *   (c) co-mention добавляет тему, которой нет в провенансе;
 *   (d) weight ниже minWeight → не привязывается, enqueue НЕ вызван.
 */

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
  };
  coreQueue: { enqueueStrategicAlignment: ReturnType<typeof vi.fn> };
  metrics: { incGoalThemeAutolink: ReturnType<typeof vi.fn> };
  cfg: { goals: { themeAutolinkMinWeight: number; themeAutolinkLlmEnabled: boolean } };
}

function buildService(
  cfgOverrides: Partial<Mocks['cfg']['goals']> = {},
): { svc: GoalThemeLinkerService; m: Mocks } {
  const m: Mocks = {
    prisma: {
      goal: { findUnique: vi.fn() },
      themeIdeaBlock: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      themeEntity: { findMany: vi.fn().mockResolvedValue([]) },
      theme: { findMany: vi.fn().mockResolvedValue([]) },
      goalTheme: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    },
    coreQueue: {
      enqueueStrategicAlignment: vi.fn().mockResolvedValue({ jobId: 'j' }),
    },
    metrics: { incGoalThemeAutolink: vi.fn() },
    cfg: {
      goals: {
        themeAutolinkMinWeight: 0.15,
        themeAutolinkLlmEnabled: false,
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
    // Оба блока цели в теме t1 → weight = 2/2 = 1.0.
    m.prisma.themeIdeaBlock.findMany.mockResolvedValue([
      { themeId: 't1' },
      { themeId: 't1' },
    ]);
    m.prisma.theme.findMany.mockResolvedValue([{ id: 't1' }]); // активная
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
    // Нет провенанса.
    m.prisma.themeIdeaBlock.findMany.mockResolvedValue([]);
    // Сущности блоков цели.
    m.prisma.ideaBlockEntity.findMany.mockResolvedValue([
      { entityId: 'e1' },
      { entityId: 'e2' },
    ]);
    // Тема t2 упоминает обе сущности → weight = 2/2 = 1.0.
    m.prisma.themeEntity.findMany.mockResolvedValue([
      { themeId: 't2', entityId: 'e1' },
      { themeId: 't2', entityId: 'e2' },
    ]);
    m.prisma.theme.findMany.mockResolvedValue([{ id: 't2' }]); // активная
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
    // minWeight=0.5; провенанс даст weight 1/10 = 0.1 < 0.5.
    ({ svc, m } = buildService({ themeAutolinkMinWeight: 0.5 }));
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sourceBlockIds: [
        'b1',
        'b2',
        'b3',
        'b4',
        'b5',
        'b6',
        'b7',
        'b8',
        'b9',
        'b10',
      ],
    });
    m.prisma.themeIdeaBlock.findMany.mockResolvedValue([{ themeId: 't1' }]);
    m.prisma.theme.findMany.mockResolvedValue([{ id: 't1' }]);

    const res = await svc.linkGoalThemes(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(res.provenance).toBe(0);
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
