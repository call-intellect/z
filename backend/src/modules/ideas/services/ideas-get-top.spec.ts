import { describe, expect, it, vi } from 'vitest';

import { IdeasService } from './ideas.service';

/**
 * TZ-1 Фаза 4.A (daily-value-engine) — unit-тест IdeasService.getTop.
 *
 * Проверяем, что getTop ре-ранкит выборку (свежая идея с целью обгоняет старую
 * тяжёлую без цели), отдаёт ≤ limit и инкрементит метрику. Mock Prisma/cfg/
 * metrics; accessResolver=null (гейт off). Без сети/времени-зависимостей.
 */
describe('IdeasService.getTop', () => {
  function buildIdea(over: Partial<Record<string, unknown>>) {
    return {
      id: 'i',
      tenantId: 't1',
      kind: 'internal',
      status: 'captured',
      statement: 's',
      rationale: null,
      weight: 1,
      supporterCount: 1,
      supporters: [],
      clusterId: null,
      sourceBlockIds: [],
      personSubjectIds: [],
      firstProposedAt: new Date('2026-06-01T00:00:00.000Z'),
      lastDiscussedAt: new Date('2026-06-08T00:00:00.000Z'),
      statusChangedAt: null,
      statusChangedByUserId: null,
      statusReason: null,
      confidence: 0.5,
      dataClass: 'internal',
      goalId: null,
      createdByUserId: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
      ...over,
    };
  }

  function build(ideas: Array<Record<string, unknown>>) {
    const prisma = {
      idea: {
        findMany: vi.fn().mockResolvedValue(ideas),
      },
    };
    const cfg = {
      // getDynamic возвращает дефолт (3-й аргумент) для всех ключей.
      getDynamic: vi.fn(async (_k: string, _e: string, def: unknown) => def),
      knowledgeAccess: { enforcement: 'off' },
    };
    const metrics = { incIdeasTopServed: vi.fn() };
    // Позиционная конструкция: prisma, specialist36, audit, accessResolver,
    // cfg, metrics. specialist36/audit не используются в getTop → заглушки.
    const svc = new IdeasService(
      prisma as never,
      {} as never,
      {} as never,
      null as never,
      cfg as never,
      metrics as never,
    );
    return { svc, prisma, metrics };
  }

  it('ре-ранкит: свежая идея с целью обгоняет старую тяжёлую без цели', async () => {
    const oldHeavy = buildIdea({
      id: 'old-heavy',
      weight: 6,
      goalId: null,
      lastDiscussedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const freshGoal = buildIdea({
      id: 'fresh-goal',
      weight: 5,
      goalId: 'g-1',
      lastDiscussedAt: new Date('2026-06-08T00:00:00.000Z'),
    });
    // Prisma отдаёт по weight desc (old-heavy первым), getTop должен переставить.
    const { svc, metrics } = build([oldHeavy, freshGoal]);
    const res = await svc.getTop({
      tenantId: 't1',
      query: { limit: 10 },
    });
    expect(res.items[0]?.id).toBe('fresh-goal');
    expect(res.items[1]?.id).toBe('old-heavy');
    expect(metrics.incIdeasTopServed).toHaveBeenCalledTimes(1);
  });

  it('отдаёт не более limit', async () => {
    const ideas = Array.from({ length: 9 }, (_v, i) =>
      buildIdea({ id: `i-${i}`, weight: 9 - i }),
    );
    const { svc } = build(ideas);
    const res = await svc.getTop({ tenantId: 't1', query: { limit: 3 } });
    expect(res.items).toHaveLength(3);
  });

  it('пустая выборка → пустой топ', async () => {
    const { svc } = build([]);
    const res = await svc.getTop({ tenantId: 't1', query: { limit: 5 } });
    expect(res.items).toEqual([]);
  });
});
