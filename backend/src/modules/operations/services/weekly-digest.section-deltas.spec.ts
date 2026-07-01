import { describe, expect, it, vi } from 'vitest';

import { WeeklyDigestService } from './weekly-digest.service';

const TENANT = 't1';
const WEEK_START = '2026-05-18';
const WEEK_END = '2026-05-24';

function buildSvc(overrides: {
  blockerCounts?: [number, number];
  insightCounts?: [number, number];
  ideaCounts?: [number, number];
}) {
  const blocker = overrides.blockerCounts ?? [0, 0];
  const insight = overrides.insightCounts ?? [0, 0];
  const idea = overrides.ideaCounts ?? [0, 0];

  let ideaBlockCountIdx = 0;
  let insightCountIdx = 0;
  let ideaCountIdx = 0;

  const storedRow = {
    id: 'wd1',
    tenantId: TENANT,
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    bodyMarkdown: 'текст',
    metricsJson: {},
    sourcesJson: {},
    llmTaskRouteId: 'deepseek:deepseek-chat',
    createdAt: new Date('2026-05-25T08:00:00Z'),
  };

  const ideaBlockCount = vi.fn().mockImplementation(() => {
    const i = ideaBlockCountIdx++;
    return Promise.resolve(blocker[i === 0 ? 0 : 1]);
  });
  const insightCount = vi.fn().mockImplementation(() => {
    const i = insightCountIdx++;
    return Promise.resolve(insight[i === 0 ? 0 : 1]);
  });
  const ideaCount = vi.fn().mockImplementation(() => {
    const i = ideaCountIdx++;
    return Promise.resolve(idea[i === 0 ? 0 : 1]);
  });

  const prisma = {
    weeklyOperationsDigest: {
      findUnique: vi.fn().mockResolvedValue(storedRow),
    },
    dailyCheckIn: { findMany: vi.fn().mockResolvedValue([]) },
    ideaBlock: {
      findMany: vi.fn().mockResolvedValue([]),
      count: ideaBlockCount,
    },
    insight: { count: insightCount },
    idea: { count: ideaCount },
    decision: { count: vi.fn().mockResolvedValue(0) },
    department: { findMany: vi.fn().mockResolvedValue([]) },
    forecastSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
  };

  const llm = { call: vi.fn() };
  const metrics = {
    incCooWeeklyDigestGenerated: vi.fn(),
    incCooWeeklyDigestFailed: vi.fn(),
  };
  const perPerson = {
    compute: vi.fn().mockResolvedValue({
      weekStart: WEEK_START,
      weekEnd: WEEK_END,
      generatedAt: '',
      total: 0,
      topRisk: [],
      rows: [],
    }),
  };
  const cfg = {
    getDynamic: vi.fn().mockResolvedValue(60000),
  };
  const svc = new WeeklyDigestService(
    prisma as never,
    llm as never,
    metrics as never,
    perPerson as never,
    cfg as never,
  );
  return { svc, prisma, ideaBlockCount, insightCount, ideaCount };
}

describe('WeeklyDigestService.sectionDeltas (ТЗ-2 Ф3)', () => {
  it('current - previous для блокеров/инсайтов/идей', async () => {
    const { svc, ideaBlockCount, insightCount, ideaCount } = buildSvc({
      blockerCounts: [7, 3],
      insightCounts: [4, 4],
      ideaCounts: [10, 6],
    });
    const dto = await svc.getStored({
      tenantId: TENANT,
      weekStart: WEEK_START,
    });
    expect(dto).not.toBeNull();
    const sd = dto!.sectionDeltas;

    expect(sd.blockers).toEqual({ current: 7, previous: 3, delta: 4 });
    expect(sd.insights).toEqual({ current: 4, previous: 4, delta: 0 });
    expect(sd.ideas).toEqual({ current: 10, previous: 6, delta: 4 });

    expect(ideaBlockCount).toHaveBeenCalledTimes(2);
    expect(insightCount).toHaveBeenCalledTimes(2);
    expect(ideaCount).toHaveBeenCalledTimes(2);
  });

  it('count-запросы вызваны с правильными фильтрами (cur vs prev)', async () => {
    const { svc, ideaBlockCount, insightCount, ideaCount } = buildSvc({
      blockerCounts: [1, 0],
      insightCounts: [1, 0],
      ideaCounts: [1, 0],
    });
    await svc.getStored({ tenantId: TENANT, weekStart: WEEK_START });

    expect(ideaBlockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          signalType: 'blocker',
        }),
      }),
    );
    expect(insightCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          status: 'active',
        }),
      }),
    );
    expect(ideaCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          status: { notIn: ['rejected', 'archived'] },
        }),
      }),
    );
  });

  it('previous=0 → delta = current (count всегда число, не null)', async () => {
    const { svc } = buildSvc({
      blockerCounts: [5, 0],
      insightCounts: [0, 0],
      ideaCounts: [2, 0],
    });
    const dto = await svc.getStored({
      tenantId: TENANT,
      weekStart: WEEK_START,
    });
    const sd = dto!.sectionDeltas;
    expect(sd.blockers).toEqual({ current: 5, previous: 0, delta: 5 });
    expect(sd.insights).toEqual({ current: 0, previous: 0, delta: 0 });
    expect(sd.ideas).toEqual({ current: 2, previous: 0, delta: 2 });
  });
});
