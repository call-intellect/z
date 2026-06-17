import { describe, expect, it, vi } from 'vitest';

import { PortfolioHealthService } from './portfolio-health.service';

describe('PortfolioHealthService', () => {
  const dateLocal = '2026-06-08';

  function buildCfg() {
    const map: Record<string, unknown> = {
      'portfolio.health.threshold_healthy': 60,
      'portfolio.health.threshold_warning': 40,
      'portfolio.health.weight_achieved': 100,
      'portfolio.health.weight_on_track': 80,
      'portfolio.health.weight_at_risk': 40,
      'portfolio.health.weight_stalled': 0,
      'portfolio.health.weight_dropped': 0,
    };
    return {
      getDynamic: vi.fn(async (key: string, _env: string, def: unknown) =>
        key in map ? map[key] : def,
      ),
    };
  }

  function build(opts: {
    goals: Array<{
      id: string;
      name: string;
      progressStatus: string;
      priority: string | null;
      sourceBlockIds: string[];
    }>;
    prevSnapshot?: { healthScore: number } | null;
  }) {
    const upsertCalls: unknown[] = [];
    const prisma = {
      goal: {
        findMany: vi.fn().mockResolvedValue(opts.goals),
      },
      portfolioHealthSnapshot: {
        upsert: vi.fn(async (arg: unknown) => {
          upsertCalls.push(arg);
          return { id: 'snap-1' };
        }),
        findFirst: vi.fn().mockResolvedValue(opts.prevSnapshot ?? null),
      },
    };
    const metrics = {
      setPortfolioHealthScore: vi.fn(),
      incPortfolioHealthSnapshot: vi.fn(),
      incPortfolioPrioritySet: vi.fn(),
    };
    const cfg = buildCfg();
    const svc = new PortfolioHealthService(prisma as never, cfg as never, metrics as never);
    return { svc, prisma, metrics, upsertCalls };
  }

  it('считает byStatus, byPriority, rows и балл; делает upsert + метрики', async () => {
    const { svc, prisma, metrics } = build({
      goals: [
        {
          id: 'g1',
          name: 'Рост выручки',
          progressStatus: 'achieved',
          priority: 'must',
          sourceBlockIds: ['blk-1', 'blk-2'],
        },
        {
          id: 'g2',
          name: 'Найм',
          progressStatus: 'on_track',
          priority: 'must',
          sourceBlockIds: [],
        },
        {
          id: 'g3',
          name: 'Рефактор',
          progressStatus: 'at_risk',
          priority: 'should',
          sourceBlockIds: [],
        },
        {
          id: 'g4',
          name: 'Без приоритета',
          progressStatus: 'stalled',
          priority: null,
          sourceBlockIds: [],
        },
      ],
      prevSnapshot: { healthScore: 40 },
    });

    const dto = await svc.compute({ tenantId: 't1', dateLocal });

    expect(dto.healthScore).toBe(55);
    expect(dto.scale.level).toBe('warning');
    expect(dto.scale.healthy).toBe(60);
    expect(dto.scale.warning).toBe(40);

    expect(dto.byStatus.achieved).toBe(1);
    expect(dto.byStatus.on_track).toBe(1);
    expect(dto.byStatus.at_risk).toBe(1);
    expect(dto.byStatus.stalled).toBe(1);
    expect(dto.byStatus.dropped).toBe(0);

    expect(dto.byPriority.must.count).toBe(2);
    expect(dto.byPriority.must.achievedCount).toBe(1);
    expect(dto.byPriority.must.achievedPercent).toBe(50);
    expect(dto.byPriority.should.count).toBe(1);
    expect(dto.byPriority.should.achievedPercent).toBe(0);
    expect(dto.byPriority.none.count).toBe(1);

    expect(dto.rows).toHaveLength(4);
    expect(dto.rows[0]?.reason).toEqual({ sourceBlockId: 'blk-1' });
    expect(dto.rows[1]?.reason).toBeNull();
    expect(dto.rows[3]?.priority).toBeNull();

    expect(dto.deltaVsPrevWeek).toBe(15);

    expect(prisma.portfolioHealthSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(metrics.setPortfolioHealthScore).toHaveBeenCalledWith(
      expect.objectContaining({ score: 55 }),
    );
    expect(metrics.incPortfolioHealthSnapshot).toHaveBeenCalledTimes(1);
  });

  it('baseline (нет прошлого снимка) → deltaVsPrevWeek = null', async () => {
    const { svc } = build({
      goals: [
        {
          id: 'g1',
          name: 'Цель',
          progressStatus: 'on_track',
          priority: 'should',
          sourceBlockIds: [],
        },
      ],
      prevSnapshot: null,
    });

    const dto = await svc.compute({ tenantId: 't1', dateLocal });
    expect(dto.deltaVsPrevWeek).toBeNull();
    expect(dto.healthScore).toBe(80);
  });

  it('нет целей → score 0, пустые rows, byPriority со всеми нулями', async () => {
    const { svc, prisma } = build({ goals: [], prevSnapshot: null });

    const dto = await svc.compute({ tenantId: 't1', dateLocal });
    expect(dto.healthScore).toBe(0);
    expect(dto.scale.level).toBe('critical');
    expect(dto.rows).toEqual([]);
    expect(dto.byPriority.must.count).toBe(0);
    expect(dto.byPriority.none.count).toBe(0);
    expect(prisma.portfolioHealthSnapshot.upsert).toHaveBeenCalledTimes(1);
  });
});
