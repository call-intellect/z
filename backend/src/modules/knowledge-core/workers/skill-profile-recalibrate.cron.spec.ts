import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillProfileRecalibrateCron } from './skill-profile-recalibrate.cron';

/**
 * Б1 + Б5 (2026-06-16) — unit-тесты recalibrate-крона:
 *   - Б1: застрявшие pending_verification старше archiveCutoff → archived
 *     (отдельный updateMany по status='pending_verification' + createdAt<cutoff);
 *   - Б5: курсорная пагинация профилей с orderBy по устареванию
 *     (lastBuildAt asc nulls first, tie-break id asc) — хвост за пределами одной
 *     страницы тоже обрабатывается, нет глобального `take:500` без orderBy.
 *
 * Конструируем крон напрямую с замоканными зависимостями (Prisma/cfg/metrics),
 * без NestJS Test-модуля и без сети. Время мокаем фейковыми датами в данных.
 */

interface Mocks {
  profileFindMany: ReturnType<typeof vi.fn>;
  traitUpdateMany: ReturnType<typeof vi.fn>;
  traitCount: ReturnType<typeof vi.fn>;
  profileCount: ReturnType<typeof vi.fn>;
  observeSkillTraitsPerProfile: ReturnType<typeof vi.fn>;
  setSkillProfilesActiveTotal: ReturnType<typeof vi.fn>;
}

function buildCron(m: Mocks): SkillProfileRecalibrateCron {
  const prisma = {
    skillProfile: {
      findMany: m.profileFindMany,
      count: m.profileCount,
    },
    skillTrait: {
      updateMany: m.traitUpdateMany,
      count: m.traitCount,
    },
  };
  const cfg = { skill: { decayMonths: 6, archiveMonths: 12 } };
  const metrics = {
    observeSkillTraitsPerProfile: m.observeSkillTraitsPerProfile,
    setSkillProfilesActiveTotal: m.setSkillProfilesActiveTotal,
  };
  return new SkillProfileRecalibrateCron(
    prisma as never,
    cfg as never,
    metrics as never,
  );
}

function makeMocks(): Mocks {
  return {
    profileFindMany: vi.fn().mockResolvedValue([]),
    // По умолчанию updateMany ничего не меняет (count:0).
    traitUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
    traitCount: vi.fn().mockResolvedValue(0),
    profileCount: vi.fn().mockResolvedValue(0),
    observeSkillTraitsPerProfile: vi.fn(),
    setSkillProfilesActiveTotal: vi.fn(),
  };
}

describe('SkillProfileRecalibrateCron.runOnce — Б1 pending→archived', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeMocks();
  });

  it('переводит застрявшие pending_verification старше archiveCutoff в archived', async () => {
    m.profileFindMany.mockResolvedValueOnce([{ id: 'p1' }]);
    // archive(active)=1, pending→archived=2, decay m→l=0, decay h→m=0
    m.traitUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // active archive
      .mockResolvedValueOnce({ count: 2 }) // pending → archived (Б1)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const cron = buildCron(m);
    const res = await cron.runOnce();

    expect(res.pendingArchived).toBe(2);
    expect(res.traitsArchived).toBe(1);
    expect(res.profilesProcessed).toBe(1);

    // Второй updateMany — это именно pending_verification + createdAt<cutoff.
    const secondCall = m.traitUpdateMany.mock.calls[1]![0];
    expect(secondCall.where.status).toBe('pending_verification');
    expect(secondCall.where.createdAt.lt).toBeInstanceOf(Date);
    expect(secondCall.data).toEqual({ status: 'archived' });
  });

  it('нет профилей → нули, pendingArchived=0', async () => {
    m.profileFindMany.mockResolvedValue([]);
    const cron = buildCron(m);
    const res = await cron.runOnce();
    expect(res).toMatchObject({
      profilesProcessed: 0,
      traitsArchived: 0,
      traitsDecayed: 0,
      pendingArchived: 0,
    });
    expect(m.traitUpdateMany).not.toHaveBeenCalled();
  });
});

describe('SkillProfileRecalibrateCron.runOnce — Б5 пагинация + orderBy', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeMocks();
  });

  it('первый запрос идёт с orderBy по lastBuildAt asc nulls first + id asc и без cursor', async () => {
    m.profileFindMany.mockResolvedValueOnce([{ id: 'p1' }]); // 1 < pageSize → стоп
    const cron = buildCron(m);
    await cron.runOnce();

    const firstQuery = m.profileFindMany.mock.calls[0]![0];
    expect(firstQuery.where).toEqual({ status: 'active' });
    expect(firstQuery.orderBy).toEqual([
      { lastBuildAt: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ]);
    // Первая страница — без cursor/skip.
    expect(firstQuery.cursor).toBeUndefined();
    expect(firstQuery.skip).toBeUndefined();
  });

  it('полная страница → следующий запрос с cursor по последнему id и skip:1', async () => {
    // PROFILE_PAGE_SIZE=200; имитируем полную страницу из 200, затем хвост из 1.
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}` }));
    m.profileFindMany
      .mockResolvedValueOnce(fullPage) // страница 1: ровно pageSize → продолжаем
      .mockResolvedValueOnce([{ id: 'tail' }]); // страница 2: 1 < pageSize → стоп

    const cron = buildCron(m);
    const res = await cron.runOnce();

    expect(m.profileFindMany).toHaveBeenCalledTimes(2);
    const secondQuery = m.profileFindMany.mock.calls[1]![0];
    // cursor = последний id первой страницы (p199), skip:1.
    expect(secondQuery.cursor).toEqual({ id: 'p199' });
    expect(secondQuery.skip).toBe(1);
    // Обработаны все 201 профиля (хвост не потерян).
    expect(res.profilesProcessed).toBe(201);
  });

  it('не превышает MAX_PROFILES_PER_SWEEP (500) даже при бесконечном потоке полных страниц', async () => {
    // Реалистичный мок: Prisma уважает take=pageSize (возвращает не больше).
    // Всегда полная страница ровно по запрошенному take → пагинация
    // ограничивается hardCap 500.
    let nextId = 0;
    m.profileFindMany.mockImplementation(
      async (q: { take: number }) =>
        Array.from({ length: q.take }, () => ({ id: `p${nextId++}` })),
    );

    const cron = buildCron(m);
    const res = await cron.runOnce();

    // 200 + 200 + 100 (последняя страница урезана remaining=100) = 500.
    expect(res.profilesProcessed).toBe(500);
    // Третий запрос — pageSize = remaining = 100.
    const thirdQuery = m.profileFindMany.mock.calls[2]![0];
    expect(thirdQuery.take).toBe(100);
    // Ровно 3 запроса (третья страница 100 < pageSize 100? нет, ==, но total=hardCap → стоп).
    expect(m.profileFindMany).toHaveBeenCalledTimes(3);
  });
});
