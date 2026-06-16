import { describe, expect, it, vi } from 'vitest';

import { ExecutablePersonaBuildCron } from './executable-persona-build.cron';

/**
 * Б14/Б15 (TZ 2026-06-16 §8.4) — unit-тесты ExecutablePersonaBuildCron.runOnce.
 *
 * Покрывают:
 *   Б15 — предфильтр профилей считает traits ТОЛЬКО layer='skill'
 *         (как гейтит buildForProfile), а не все слои.
 *   Б14 — выборка профилей и ролей идёт с детерминированным orderBy
 *         «самые несвежие первыми» + курсор (а не первые MAX по scan-order),
 *         и проходит ВЕСЬ хвост (пагинация при заполненной странице).
 *
 * Все Prisma/Cfg/Builder/Metrics мокированы.
 */
describe('ExecutablePersonaBuildCron.runOnce — Б14/Б15', () => {
  function makeCron(opts: {
    profilePages: Array<Array<{ id: string; traits: Array<{ id: string }> }>>;
    rolePages: Array<Array<{ id: string; tenantId: string }>>;
    minTraits?: number;
  }): {
    cron: ExecutablePersonaBuildCron;
    profileFindMany: ReturnType<typeof vi.fn>;
    roleFindMany: ReturnType<typeof vi.fn>;
    buildForProfile: ReturnType<typeof vi.fn>;
    buildForRole: ReturnType<typeof vi.fn>;
  } {
    let profileCall = 0;
    const profileFindMany = vi.fn(async () => {
      const page = opts.profilePages[profileCall] ?? [];
      profileCall++;
      return page;
    });
    let roleCall = 0;
    const roleFindMany = vi.fn(async () => {
      const page = opts.rolePages[roleCall] ?? [];
      roleCall++;
      return page;
    });

    const prisma = {
      skillProfile: { findMany: profileFindMany },
      role: { findMany: roleFindMany },
      executablePersona: { count: vi.fn(async () => 0) },
    };
    const cfg = {
      persona: { scheduledRebuildEnabled: true, minTraits: opts.minTraits ?? 3 },
    };
    const buildForProfile = vi.fn(async () => ({ id: 'persona-x' }));
    const buildForRole = vi.fn(async () => ({ id: 'persona-r' }));
    const builder = { buildForProfile, buildForRole };
    const metrics = { setPersonaActiveTotal: vi.fn() };

    const cron = new ExecutablePersonaBuildCron(
      prisma as never,
      cfg as never,
      builder as never,
      metrics as never,
    );
    return { cron, profileFindMany, roleFindMany, buildForProfile, buildForRole };
  }

  it('Б15: предфильтр traits фильтрует только layer=skill', async () => {
    const { cron, profileFindMany } = makeCron({
      profilePages: [[{ id: 'p1', traits: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }]],
      rolePages: [[]],
    });
    await cron.runOnce();

    const arg = profileFindMany.mock.calls[0]![0] as {
      select: { traits: { where: Record<string, unknown> } };
    };
    expect(arg.select.traits.where).toMatchObject({
      status: 'active',
      layer: 'skill',
    });
  });

  it('Б14: профили выбираются с orderBy lastBuildAt asc nulls first + id asc', async () => {
    const { cron, profileFindMany, roleFindMany } = makeCron({
      profilePages: [[{ id: 'p1', traits: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }]],
      rolePages: [[{ id: 'r1', tenantId: 'org1' }]],
    });
    await cron.runOnce();

    const pArg = profileFindMany.mock.calls[0]![0] as { orderBy: unknown };
    expect(pArg.orderBy).toEqual([
      { lastBuildAt: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ]);

    const rArg = roleFindMany.mock.calls[0]![0] as { orderBy: unknown };
    expect(rArg.orderBy).toEqual([{ updatedAt: 'asc' }, { id: 'asc' }]);
  });

  it('Б14: курсор проходит весь хвост (заполненная страница → второй запрос с cursor)', async () => {
    // Имитируем переполнение: первый запрос вернул ровно MAX (500) элементов →
    // должен последовать второй запрос с cursor по последнему id.
    const fullPage = Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      traits: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    }));
    const { cron, profileFindMany } = makeCron({
      profilePages: [fullPage, []],
      rolePages: [[]],
    });
    await cron.runOnce();

    expect(profileFindMany).toHaveBeenCalledTimes(2);
    const secondArg = profileFindMany.mock.calls[1]![0] as {
      cursor?: { id: string };
      skip?: number;
    };
    expect(secondArg.cursor).toEqual({ id: 'p499' });
    expect(secondArg.skip).toBe(1);
  });
});
