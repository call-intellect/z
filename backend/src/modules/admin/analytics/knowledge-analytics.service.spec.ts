import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeAnalyticsService } from './knowledge-analytics.service';

interface CountableDelegate {
  count: ReturnType<typeof vi.fn>;
  groupBy?: ReturnType<typeof vi.fn>;
}

function makeDelegate(
  countByCall: number[],
  groupByResult?: Array<{ tenantId: string; _count: { _all: number } }>,
): CountableDelegate {
  let call = 0;
  const d: CountableDelegate = {
    count: vi.fn().mockImplementation(() => {
      const v = countByCall[call] ?? 0;
      call += 1;
      return Promise.resolve(v);
    }),
  };
  if (groupByResult) {
    d.groupBy = vi.fn().mockResolvedValue(groupByResult);
  }
  return d;
}

function buildPrismaMock(overrides: Record<string, unknown> = {}): {
  prisma: PrismaService;
} {
  const defaultDelegate = makeDelegate([0, 0]);
  const base = {
    ideaBlock: defaultDelegate,
    entity: defaultDelegate,
    theme: defaultDelegate,
    ideaBlockLink: defaultDelegate,
    card: defaultDelegate,
    decision: defaultDelegate,
    insight: defaultDelegate,
    idea: defaultDelegate,
    regulation: defaultDelegate,
    process: defaultDelegate,
    org: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { prisma: base as unknown as PrismaService };
}

describe('KnowledgeAnalyticsService', () => {
  it('getOverview() возвращает структуру со всеми 10 сущностями и 7d growth', async () => {
    const { prisma } = buildPrismaMock({
      ideaBlock: makeDelegate([1000, 50]),
      entity: makeDelegate([500, 10]),
      theme: makeDelegate([80, 2]),
      ideaBlockLink: makeDelegate([1500, 100]),
      card: makeDelegate([30, 1]),
      decision: makeDelegate([12, 0]),
      insight: makeDelegate([7, 1]),
      idea: makeDelegate([20, 3]),
      regulation: makeDelegate([4, 0]),
      process: makeDelegate([6, 1]),
    });
    const svc = new KnowledgeAnalyticsService(prisma);

    const overview = await svc.getOverview('week');

    expect(overview.period).toBe('week');
    expect(overview.blocks).toEqual({ total: 1000, growth7d: 50 });
    expect(overview.entities).toEqual({ total: 500, growth7d: 10 });
    expect(overview.themes).toEqual({ total: 80, growth7d: 2 });
    expect(overview.links).toEqual({ total: 1500, growth7d: 100 });
    expect(overview.cards).toEqual({ total: 30, growth7d: 1 });
    expect(overview.decisions).toEqual({ total: 12, growth7d: 0 });
    expect(overview.insights).toEqual({ total: 7, growth7d: 1 });
    expect(overview.ideas).toEqual({ total: 20, growth7d: 3 });
    expect(overview.regulations).toEqual({ total: 4, growth7d: 0 });
    expect(overview.processes).toEqual({ total: 6, growth7d: 1 });
  });

  it('safeCount() возвращает 0 при отсутствии delegate (модель удалили из schema)', async () => {
    const { prisma } = buildPrismaMock({
      card: undefined,
    });
    const svc = new KnowledgeAnalyticsService(prisma);
    const overview = await svc.getOverview('day');
    expect(overview.cards).toEqual({ total: 0, growth7d: 0 });
  });

  it('safeCount() возвращает 0, если delegate.count выкинул исключение', async () => {
    const failingDelegate: CountableDelegate = {
      count: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const { prisma } = buildPrismaMock({ theme: failingDelegate });
    const svc = new KnowledgeAnalyticsService(prisma);
    const overview = await svc.getOverview('day');
    expect(overview.themes).toEqual({ total: 0, growth7d: 0 });
  });

  it('getByOrg() мерджит groupBy результаты по tenantId + JOIN с Org для name', async () => {
    const ideaBlockGB = [
      { tenantId: 'orgA', _count: { _all: 100 } },
      { tenantId: 'orgB', _count: { _all: 50 } },
    ];
    const entityGB = [
      { tenantId: 'orgA', _count: { _all: 30 } },
      { tenantId: 'orgB', _count: { _all: 80 } },
    ];
    const themeGB = [
      { tenantId: 'orgA', _count: { _all: 10 } },
      { tenantId: 'orgB', _count: { _all: 5 } },
    ];

    const { prisma } = buildPrismaMock({
      ideaBlock: makeDelegate([0, 0], ideaBlockGB),
      entity: makeDelegate([0, 0], entityGB),
      theme: makeDelegate([0, 0], themeGB),
      org: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'orgA', name: 'Org Alpha' },
          { id: 'orgB', name: 'Org Beta' },
        ]),
      },
    });
    const svc = new KnowledgeAnalyticsService(prisma);

    const result = await svc.getByOrg('week', 10);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      tenantId: 'orgA',
      name: 'Org Alpha',
      blocks: 100,
      entities: 30,
      themes: 10,
    });
    expect(result.items[1]).toEqual({
      tenantId: 'orgB',
      name: 'Org Beta',
      blocks: 50,
      entities: 80,
      themes: 5,
    });
  });

  it('getByOrg() возвращает пустой items, если ни у одной Org нет данных за период', async () => {
    const { prisma } = buildPrismaMock({
      ideaBlock: makeDelegate([0, 0], []),
      entity: makeDelegate([0, 0], []),
      theme: makeDelegate([0, 0], []),
    });
    const svc = new KnowledgeAnalyticsService(prisma);

    const result = await svc.getByOrg('week', 10);
    expect(result.items).toEqual([]);
  });

  it('getByOrg() ограничивает выборку параметром limit', async () => {
    const ideaBlockGB = Array.from({ length: 30 }, (_, i) => ({
      tenantId: `org${i}`,
      _count: { _all: 100 - i },
    }));
    const { prisma } = buildPrismaMock({
      ideaBlock: makeDelegate([0, 0], ideaBlockGB),
      entity: makeDelegate([0, 0], []),
      theme: makeDelegate([0, 0], []),
      org: {
        findMany: vi
          .fn()
          .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
            Promise.resolve(where.id.in.map((id) => ({ id, name: `Name ${id}` }))),
          ),
      },
    });
    const svc = new KnowledgeAnalyticsService(prisma);

    const result = await svc.getByOrg('week', 5);
    expect(result.items).toHaveLength(5);
    expect(result.items[0]?.tenantId).toBe('org0');
    expect(result.items[4]?.tenantId).toBe('org4');
  });

  it('getGrowth() заполняет «дырки» в днях нулями', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const d3 = new Date(today);
    d3.setUTCDate(d3.getUTCDate() - 3);

    const rawRows = [{ date: d3.toISOString().slice(0, 10), count: 5 }];

    const { prisma } = buildPrismaMock({
      $queryRawUnsafe: vi.fn().mockResolvedValue(rawRows),
    });

    const svc = new KnowledgeAnalyticsService(prisma);
    const result = await svc.getGrowth('week');

    expect(result.period).toBe('week');
    expect(result.items.length).toBeGreaterThanOrEqual(7);
    const point = result.items.find((p) => p.date === d3.toISOString().slice(0, 10));
    expect(point?.blocksAdded).toBe(5);
    const zeros = result.items.filter(
      (p) => p.blocksAdded === 0 && p.themesAdded === 0 && p.entitiesAdded === 0,
    );
    expect(zeros.length).toBeGreaterThan(0);
  });

  it('getGrowth() возвращает [] для всех дней, если raw SQL упал', async () => {
    const { prisma } = buildPrismaMock({
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const svc = new KnowledgeAnalyticsService(prisma);
    const result = await svc.getGrowth('week');
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.every(
        (p) => p.blocksAdded === 0 && p.themesAdded === 0 && p.entitiesAdded === 0,
      ),
    ).toBe(true);
  });
});
