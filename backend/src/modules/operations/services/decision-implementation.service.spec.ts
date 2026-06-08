import { describe, expect, it, vi } from 'vitest';

import { DecisionImplementationService } from './decision-implementation.service';

/**
 * TZ-1 Фаза 3.B (daily-value-engine) — unit-тесты DecisionImplementationService.
 *
 * Mock Prisma/cfg/metrics, без сети/времени. Покрываем:
 *   1. computeForTenant — детекция stalled + апдейт статуса + метрика на переход.
 *   2. getDecisionThroughput — корректный % (count в паре с doneWithOutcomes).
 *   3. идемпотентность — повторный прогон не инкрементит decision_stalled (нет
 *      перехода).
 */
describe('DecisionImplementationService', () => {
  const now = new Date('2026-06-08T10:00:00.000Z');

  function buildCfg() {
    return {
      getDynamic: vi.fn(async (key: string, _env: string, def: unknown) =>
        key === 'decision.stale_days' ? 21 : def,
      ),
    };
  }

  function build(opts: {
    decisions?: Array<{
      id: string;
      statement: string | null;
      text: string | null;
      decidedByPersonIds: string[];
      decidedAt: Date | null;
      createdAt: Date;
      linkedTaskCount: number;
      actualOutcomes: string | null;
      implementationStatus: string | null;
    }>;
    counts?: { total: number; done: number };
  }) {
    const updates: Array<{ where: unknown; data: unknown }> = [];
    let countCall = 0;
    const prisma = {
      decision: {
        findMany: vi.fn().mockResolvedValue(opts.decisions ?? []),
        update: vi.fn(async (arg: { where: unknown; data: unknown }) => {
          updates.push(arg);
          return { id: 'd1' };
        }),
        count: vi.fn(async () => {
          // 1-й вызов — total, 2-й — doneWithOutcomes (порядок в Promise.all).
          const v = countCall === 0 ? opts.counts?.total ?? 0 : opts.counts?.done ?? 0;
          countCall++;
          return v;
        }),
      },
    };
    const metrics = {
      incDecisionStalled: vi.fn(),
      setDecisionThroughputPercent: vi.fn(),
    };
    const svc = new DecisionImplementationService(
      prisma as never,
      buildCfg() as never,
      metrics as never,
    );
    return { svc, prisma, metrics, updates };
  }

  it('старое решение без задач/outcomes → stalled + метрика на переход', async () => {
    const { svc, metrics } = build({
      decisions: [
        {
          id: 'd1',
          statement: 'Перейти на новый CRM',
          text: null,
          decidedByPersonIds: ['p1'],
          decidedAt: new Date('2026-05-01T00:00:00Z'), // > 21 дней назад
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: null,
          implementationStatus: null, // ранее не stalled → переход
        },
      ],
      counts: { total: 1, done: 0 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.checked).toBe(1);
    expect(res.stalled).toHaveLength(1);
    expect(res.stalled[0]!.decidedByPersonIds).toEqual(['p1']);
    expect(metrics.incDecisionStalled).toHaveBeenCalledTimes(1);
  });

  it('идемпотентность: уже stalled → НЕ инкрементит метрику снова', async () => {
    const { svc, metrics } = build({
      decisions: [
        {
          id: 'd1',
          statement: 'X',
          text: null,
          decidedByPersonIds: ['p1'],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: null,
          implementationStatus: 'stalled', // уже было stalled
        },
      ],
      counts: { total: 1, done: 0 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.stalled).toHaveLength(1);
    expect(metrics.incDecisionStalled).not.toHaveBeenCalled();
  });

  it('решение с outcomes → done, не stalled', async () => {
    const { svc } = build({
      decisions: [
        {
          id: 'd1',
          statement: 'Y',
          text: null,
          decidedByPersonIds: [],
          decidedAt: new Date('2026-05-01T00:00:00Z'),
          createdAt: new Date('2026-05-01T00:00:00Z'),
          linkedTaskCount: 0,
          actualOutcomes: 'Внедрено, метрики выросли',
          implementationStatus: null,
        },
      ],
      counts: { total: 1, done: 1 },
    });
    const res = await svc.computeForTenant({ tenantId: 't1', now });
    expect(res.stalled).toHaveLength(0);
  });

  describe('getDecisionThroughput', () => {
    it('% = done/total × 100', async () => {
      const { svc } = build({ counts: { total: 10, done: 4 } });
      const tp = await svc.getDecisionThroughput({
        tenantId: 't1',
        from: new Date('2026-03-01'),
        to: now,
      });
      expect(tp).toEqual({
        total: 10,
        doneWithOutcomes: 4,
        throughputPercent: 40,
      });
    });

    it('total=0 → 0% без деления на ноль', async () => {
      const { svc } = build({ counts: { total: 0, done: 0 } });
      const tp = await svc.getDecisionThroughput({
        tenantId: 't1',
        from: new Date('2026-03-01'),
        to: now,
      });
      expect(tp.throughputPercent).toBe(0);
    });
  });
});
