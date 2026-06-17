import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillProfileRecalibrateCron } from './skill-profile-recalibrate.cron';

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
  return new SkillProfileRecalibrateCron(prisma as never, cfg as never, metrics as never);
}

function makeMocks(): Mocks {
  return {
    profileFindMany: vi.fn().mockResolvedValue([]),
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
    m.traitUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const cron = buildCron(m);
    const res = await cron.runOnce();

    expect(res.pendingArchived).toBe(2);
    expect(res.traitsArchived).toBe(1);
    expect(res.profilesProcessed).toBe(1);

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
    m.profileFindMany.mockResolvedValueOnce([{ id: 'p1' }]);
    const cron = buildCron(m);
    await cron.runOnce();

    const firstQuery = m.profileFindMany.mock.calls[0]![0];
    expect(firstQuery.where).toEqual({ status: 'active' });
    expect(firstQuery.orderBy).toEqual([
      { lastBuildAt: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ]);
    expect(firstQuery.cursor).toBeUndefined();
    expect(firstQuery.skip).toBeUndefined();
  });

  it('полная страница → следующий запрос с cursor по последнему id и skip:1', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}` }));
    m.profileFindMany.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([{ id: 'tail' }]);

    const cron = buildCron(m);
    const res = await cron.runOnce();

    expect(m.profileFindMany).toHaveBeenCalledTimes(2);
    const secondQuery = m.profileFindMany.mock.calls[1]![0];
    expect(secondQuery.cursor).toEqual({ id: 'p199' });
    expect(secondQuery.skip).toBe(1);
    expect(res.profilesProcessed).toBe(201);
  });

  it('не превышает MAX_PROFILES_PER_SWEEP (500) даже при бесконечном потоке полных страниц', async () => {
    let nextId = 0;
    m.profileFindMany.mockImplementation(async (q: { take: number }) =>
      Array.from({ length: q.take }, () => ({ id: `p${nextId++}` })),
    );

    const cron = buildCron(m);
    const res = await cron.runOnce();

    expect(res.profilesProcessed).toBe(500);
    const thirdQuery = m.profileFindMany.mock.calls[2]![0];
    expect(thirdQuery.take).toBe(100);
    expect(m.profileFindMany).toHaveBeenCalledTimes(3);
  });
});
