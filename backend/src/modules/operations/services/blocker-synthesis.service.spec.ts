import { describe, expect, it, vi } from 'vitest';

import {
  BlockerSynthesisService,
  detectImpactSignals,
  parseBlockersJson,
} from './blocker-synthesis.service';

/**
 * TZ-1 Фаза 3.A (daily-value-engine) — unit-тесты BlockerSynthesisService.
 *
 * Mock Prisma/cfg/llm/insights, без сети/времени. Покрываем:
 *   1. computeForTenant — кластеризация + статусы new/recurring + upsert.
 *   2. recurring + daysOpen ≥ N → мост в Insight (bridgeRecurringBlocker).
 *   3. resolved — кластер из окна, не замеченный сегодня.
 *   4. идемпотентность — повторный прогон = upsert (без дублей).
 *   5. parseBlockersJson / detectImpactSignals.
 */
describe('BlockerSynthesisService', () => {
  function buildCfg(overrides?: Record<string, unknown>) {
    const map: Record<string, unknown> = {
      'blocker_synthesis.lookback_days': 7,
      'blocker_synthesis.recurring_days': 2,
      'blocker_synthesis.impact.base': 1,
      'blocker_synthesis.impact.customer': 4,
      'blocker_synthesis.impact.deadline': 3,
      'blocker_synthesis.impact.commitment': 2,
      'blocker_synthesis.impact.per_day_open': 0.5,
      ...overrides,
    };
    return {
      getDynamic: vi.fn(
        async (key: string, _env: string, def: unknown) =>
          key in map ? map[key] : def,
      ),
    };
  }

  function build(opts: {
    checkIns?: Array<{ personId: string; blockersJson: unknown }>;
    ideaBlocks?: Array<{
      id: string;
      name: string;
      criticalQuestion: string;
      commitmentAuthorPersonId: string | null;
    }>;
    existing?: Array<{
      id: string;
      clusterKey: string;
      firstSeenDateLocal: string;
      lastSeenDateLocal: string;
      linkedInsightId: string | null;
      status: string;
    }>;
  }) {
    const upserts: Array<{ where: unknown; create: unknown; update: unknown }> =
      [];
    const updates: Array<{ where: unknown; data: unknown }> = [];
    const prisma = {
      dailyCheckIn: {
        findMany: vi.fn().mockResolvedValue(opts.checkIns ?? []),
      },
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue(opts.ideaBlocks ?? []),
      },
      blockerSynthesis: {
        findMany: vi.fn().mockResolvedValue(opts.existing ?? []),
        upsert: vi.fn(async (arg: { where: unknown; create: unknown; update: unknown }) => {
          upserts.push(arg);
          return { id: 'bs1' };
        }),
        update: vi.fn(async (arg: { where: unknown; data: unknown }) => {
          updates.push(arg);
          return { id: 'bs1' };
        }),
      },
    };
    const metrics = { incBlockerSynthesisRecurring: vi.fn() };
    const llm = { call: vi.fn().mockResolvedValue({ text: 'сводка' }) };
    const insights = {
      bridgeRecurringBlocker: vi.fn().mockResolvedValue('ins1'),
    };
    const svc = new BlockerSynthesisService(
      prisma as never,
      buildCfg() as never,
      metrics as never,
      llm as never,
      insights as never,
    );
    return { svc, prisma, metrics, llm, insights, upserts, updates };
  }

  it('новый блокер дня → status=new, upsert вызван', async () => {
    const { svc, upserts, metrics } = build({
      checkIns: [
        { personId: 'p1', blockersJson: [{ text: 'жду доступ к базе' }] },
      ],
    });
    const res = await svc.computeForTenant({
      tenantId: 't1',
      dateLocal: '2026-06-08',
    });
    expect(res.newCount).toBe(1);
    expect(res.recurringCount).toBe(0);
    expect(upserts).toHaveLength(1);
    expect((upserts[0]!.create as { status: string }).status).toBe('new');
    expect(metrics.incBlockerSynthesisRecurring).toHaveBeenCalledWith({
      status: 'new',
    });
  });

  it('повторяющийся блокер ≥ N дней → recurring + мост в Insight', async () => {
    const { svc, insights } = build({
      checkIns: [
        { personId: 'p1', blockersJson: [{ text: 'жду доступ к базе' }] },
      ],
      existing: [
        {
          id: 'bs-prior',
          clusterKey: 'жду доступ базе',
          firstSeenDateLocal: '2026-06-04',
          lastSeenDateLocal: '2026-06-07',
          linkedInsightId: null,
          status: 'recurring',
        },
      ],
    });
    const res = await svc.computeForTenant({
      tenantId: 't1',
      dateLocal: '2026-06-08',
    });
    expect(res.recurringCount).toBe(1);
    expect(res.bridgedInsights).toBe(1);
    expect(insights.bridgeRecurringBlocker).toHaveBeenCalledTimes(1);
  });

  it('кластер из окна, не замеченный сегодня → resolved', async () => {
    const { svc, updates, metrics } = build({
      checkIns: [], // сегодня ничего
      ideaBlocks: [],
      existing: [
        {
          id: 'bs-old',
          clusterKey: 'старый блокер',
          firstSeenDateLocal: '2026-06-05',
          lastSeenDateLocal: '2026-06-07',
          linkedInsightId: null,
          status: 'recurring',
        },
      ],
    });
    const res = await svc.computeForTenant({
      tenantId: 't1',
      dateLocal: '2026-06-08',
    });
    expect(res.resolvedCount).toBe(1);
    expect(updates.some((u) => (u.data as { status?: string }).status === 'resolved')).toBe(
      true,
    );
    expect(metrics.incBlockerSynthesisRecurring).toHaveBeenCalledWith({
      status: 'resolved',
    });
  });

  it('идемпотентность: тот же блокер второй прогон → снова upsert (не дубль)', async () => {
    const { svc, upserts } = build({
      checkIns: [
        { personId: 'p1', blockersJson: [{ text: 'жду доступ к базе' }] },
      ],
      existing: [
        {
          id: 'bs-prior',
          clusterKey: 'жду доступ базе',
          firstSeenDateLocal: '2026-06-08',
          lastSeenDateLocal: '2026-06-08',
          linkedInsightId: null,
          status: 'new',
        },
      ],
    });
    await svc.computeForTenant({ tenantId: 't1', dateLocal: '2026-06-08' });
    // upsert по unique (tenantId, clusterKey) — один вызов, не два create.
    expect(upserts).toHaveLength(1);
  });

  describe('parseBlockersJson', () => {
    it('массив объектов { text }', () => {
      expect(
        parseBlockersJson([{ text: 'a' }, { text: ' b ' }] as never),
      ).toEqual(['a', 'b']);
    });
    it('массив строк', () => {
      expect(parseBlockersJson(['x', '  y '] as never)).toEqual(['x', 'y']);
    });
    it('не массив → []', () => {
      expect(parseBlockersJson({ text: 'a' } as never)).toEqual([]);
      expect(parseBlockersJson(null as never)).toEqual([]);
    });
  });

  describe('detectImpactSignals', () => {
    it('детектит клиента/дедлайн/обещание по ключевым словам', () => {
      expect(detectImpactSignals('срываем дедлайн по клиенту, я обещал')).toEqual(
        { customer: true, deadline: true, commitment: true },
      );
    });
    it('бытовой блокер → всё false', () => {
      expect(detectImpactSignals('кофемашина сломалась')).toEqual({
        customer: false,
        deadline: false,
        commitment: false,
      });
    });
  });
});
