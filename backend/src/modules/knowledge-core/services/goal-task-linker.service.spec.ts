import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalTaskLinkerService } from './goal-task-linker.service';

/**
 * Agent-chain overhaul Фаза 4.1 — unit-тесты GoalTaskLinkerService.
 *
 * Мокаем Prisma / LlmRouter / Metrics / TypedConfig. Покрываем:
 *   (1) флаг OFF → no-op (БЕЗ запросов / LLM);
 *   (2) source!=='ai' → no-op;
 *   (3) ungoaled issue + арбитр develops:true conf>=0.6 → updateMany с goalId
 *       (where goalId:null);
 *   (4) арбитр develops:false → update НЕ зван;
 *   (5) нет кандидатов → LLM НЕ зван.
 */

const TENANT = 'org-1';
const GOAL_ID = 'goal-1';

interface Mocks {
  prisma: {
    goal: { findUnique: ReturnType<typeof vi.fn> };
    ideaBlockEvidence: { findMany: ReturnType<typeof vi.fn> };
    rawEvent: { findMany: ReturnType<typeof vi.fn> };
    issue: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  llm: { call: ReturnType<typeof vi.fn> };
  cfg: {
    goals: { goalTaskLinkEnabled: boolean };
    aiFeatures: { promptInjectionGuardEnabled: boolean };
  };
  metrics: { incGoalTaskLink: ReturnType<typeof vi.fn> };
}

function buildService(
  cfgOverrides: Partial<Mocks['cfg']['goals']> = {},
): { svc: GoalTaskLinkerService; m: Mocks } {
  const m: Mocks = {
    prisma: {
      goal: { findUnique: vi.fn() },
      ideaBlockEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      rawEvent: { findMany: vi.fn().mockResolvedValue([]) },
      issue: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
    llm: { call: vi.fn() },
    cfg: {
      goals: { goalTaskLinkEnabled: true, ...cfgOverrides },
      aiFeatures: { promptInjectionGuardEnabled: false },
    },
    metrics: { incGoalTaskLink: vi.fn() },
  };

  const svc = new GoalTaskLinkerService(
    m.prisma as never,
    m.llm as never,
    m.cfg as never,
    m.metrics as never,
  );
  return { svc, m };
}

/** Готовит цель→встречу→1 ungoaled-задачу для happy-path. */
function primeChain(m: Mocks, taskId = 'task-1'): void {
  m.prisma.goal.findUnique.mockResolvedValue({
    tenantId: TENANT,
    source: 'ai',
    sourceBlockIds: ['b1', 'b2'],
    name: 'Увеличить выручку на 20% за квартал',
  });
  m.prisma.ideaBlockEvidence.findMany.mockResolvedValue([
    { rawEventId: 're1' },
  ]);
  m.prisma.rawEvent.findMany.mockResolvedValue([
    { sourceExternalId: 'meeting-1' },
  ]);
  m.prisma.issue.findMany.mockResolvedValue([
    { id: taskId, title: 'Запустить рекламную кампанию' },
  ]);
}

describe('GoalTaskLinkerService.linkGoalTasks', () => {
  let svc: GoalTaskLinkerService;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('(1) флаг OFF → no-op, без запросов и LLM', async () => {
    ({ svc, m } = buildService({ goalTaskLinkEnabled: false }));

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.goal.findUnique).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('(2) source!==ai → no-op (LLM не зван)', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      source: 'manual',
      sourceBlockIds: ['b1'],
      name: 'Ручная цель',
    });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.ideaBlockEvidence.findMany).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('(3) develops:true conf>=0.6 → updateMany с goalId (where goalId:null)', async () => {
    primeChain(m, 'task-1');
    m.llm.call.mockResolvedValue({
      text: JSON.stringify({
        links: [{ taskId: 'task-1', develops: true, confidence: 0.9 }],
      }),
    });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(1);
    expect(m.prisma.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task-1',
          tenantId: TENANT,
          goalId: null,
        }),
        data: { goalId: GOAL_ID },
      }),
    );
    expect(m.metrics.incGoalTaskLink).toHaveBeenCalledWith({ result: 'linked' });
  });

  it('(3b) develops:true но confidence<0.6 → update НЕ зван (rejected)', async () => {
    primeChain(m, 'task-1');
    m.llm.call.mockResolvedValue({
      text: JSON.stringify({
        links: [{ taskId: 'task-1', develops: true, confidence: 0.3 }],
      }),
    });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
    expect(m.metrics.incGoalTaskLink).toHaveBeenCalledWith({
      result: 'rejected',
    });
  });

  it('(3c) арбитр вернул чужой taskId → update НЕ зван (sanity)', async () => {
    primeChain(m, 'task-1');
    m.llm.call.mockResolvedValue({
      text: JSON.stringify({
        links: [{ taskId: 'hallucinated', develops: true, confidence: 0.95 }],
      }),
    });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('(4) develops:false → update НЕ зван', async () => {
    primeChain(m, 'task-1');
    m.llm.call.mockResolvedValue({
      text: JSON.stringify({
        links: [{ taskId: 'task-1', develops: false, confidence: 0.9 }],
      }),
    });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('(5) нет кандидатов-задач → LLM НЕ зван', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      source: 'ai',
      sourceBlockIds: ['b1'],
      name: 'Цель без задач',
    });
    m.prisma.ideaBlockEvidence.findMany.mockResolvedValue([
      { rawEventId: 're1' },
    ]);
    m.prisma.rawEvent.findMany.mockResolvedValue([
      { sourceExternalId: 'meeting-1' },
    ]);
    m.prisma.issue.findMany.mockResolvedValue([]); // нет ungoaled-задач

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.llm.call).not.toHaveBeenCalled();
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('чужой tenant → no-op', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: 'other-org',
      source: 'ai',
      sourceBlockIds: ['b1'],
      name: 'Чужая цель',
    });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.ideaBlockEvidence.findMany).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
  });

  it('нет встреч у цели (нет meeting-свидетельств) → LLM НЕ зван', async () => {
    m.prisma.goal.findUnique.mockResolvedValue({
      tenantId: TENANT,
      source: 'ai',
      sourceBlockIds: ['b1'],
      name: 'Цель без встреч',
    });
    m.prisma.ideaBlockEvidence.findMany.mockResolvedValue([]); // нет evidence

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.prisma.issue.findMany).not.toHaveBeenCalled();
    expect(m.llm.call).not.toHaveBeenCalled();
  });

  it('полный провал арбитра (битый JSON ×2) → fallback, привязок нет', async () => {
    primeChain(m, 'task-1');
    m.llm.call.mockResolvedValue({ text: 'не json' });

    const res = await svc.linkGoalTasks(TENANT, GOAL_ID);

    expect(res.linked).toBe(0);
    expect(m.llm.call).toHaveBeenCalledTimes(2); // retry×2
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
    expect(m.metrics.incGoalTaskLink).toHaveBeenCalledWith({
      result: 'fallback',
    });
  });
});
