import { describe, expect, it, vi } from 'vitest';

import type { OperationsDashboardService } from './operations-dashboard.service';
import { collectWindowSignals } from './window-signals';

function buildInsightRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ins1',
    kind: 'risk',
    statement: 'риск задержки',
    severity: 'high',
    status: 'active',
    dynamicLabel: 'growing',
    frequencyScore: 3.5,
    dynamicScore: 7.2,
    affectedEntityIds: ['e1'],
    relatedDecisionIds: ['d1'],
    causeCategory: 'communication',
    firstObservedAt: new Date('2026-05-19T10:00:00.000Z'),
    lastObservedAt: new Date('2026-05-21T10:00:00.000Z'),
    sourceBlockIds: ['a', 'b'],
    confidence: 0.75,
    updatedAt: new Date('2026-05-22T10:00:00.000Z'),
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    ...overrides,
  };
}

function buildClusterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cl1',
    name: 'Кластер идей',
    description: 'описание',
    ideaIds: ['i1', 'i2'],
    clusterWeight: 12.5,
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    updatedAt: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  };
}

describe('collectWindowSignals', () => {
  const FROM = '2026-05-18';
  const TO = '2026-05-24';
  const fromUtc = new Date(`${FROM}T00:00:00.000Z`);
  const toUtc = new Date(`${TO}T23:59:59.999Z`);

  function buildDeps(opts: {
    insights?: unknown[];
    clusters?: unknown[];
    frictionItems?: unknown[];
    blockerItems?: unknown[];
  }) {
    const prisma = {
      insight: { findMany: vi.fn().mockResolvedValue(opts.insights ?? []) },
      ideaCluster: { findMany: vi.fn().mockResolvedValue(opts.clusters ?? []) },
    };
    const opsDashboard = {
      getTeamFrictions: vi.fn().mockResolvedValue({
        items: opts.frictionItems ?? [],
        total: (opts.frictionItems ?? []).length,
      }),
      getBlockers: vi.fn().mockResolvedValue({
        items: opts.blockerItems ?? [],
        total: (opts.blockerItems ?? []).length,
      }),
    };
    return { prisma, opsDashboard };
  }

  it('передаёт правильное окно во все выборки', async () => {
    const { prisma, opsDashboard } = buildDeps({});
    await collectWindowSignals({
      prisma: prisma as never,
      opsDashboard: opsDashboard as unknown as OperationsDashboardService,
      tenantId: 't1',
      from: FROM,
      to: TO,
    });

    expect(prisma.insight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          status: { in: ['active', 'mitigating'] },
          lastObservedAt: expect.objectContaining({ gte: fromUtc, lte: toUtc }),
        }),
        take: 20,
      }),
    );
    expect(prisma.ideaCluster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          updatedAt: expect.objectContaining({ gte: fromUtc, lte: toUtc }),
        }),
        take: 12,
      }),
    );
    expect(opsDashboard.getTeamFrictions).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        since: fromUtc,
        to: toUtc,
        limit: 12,
      }),
    );
    expect(opsDashboard.getBlockers).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        window: { from: FROM, to: TO },
        limit: 20,
      }),
    );
  });

  it('маппит insight/cluster в правильную форму', async () => {
    const { prisma, opsDashboard } = buildDeps({
      insights: [buildInsightRow()],
      clusters: [buildClusterRow()],
    });
    const result = await collectWindowSignals({
      prisma: prisma as never,
      opsDashboard: opsDashboard as unknown as OperationsDashboardService,
      tenantId: 't1',
      from: FROM,
      to: TO,
    });

    expect(result.risksByCause).toHaveLength(1);
    const risk = result.risksByCause[0]!;
    expect(risk.sourceBlocksCount).toBe(2);
    expect(risk.causeCategory).toBe('communication');
    expect(risk.frequencyScore).toBe(3.5);
    expect(risk.dynamicScore).toBe(7.2);
    expect(risk.confidence).toBe(0.75);
    expect(typeof risk.frequencyScore).toBe('number');
    expect(typeof risk.dynamicScore).toBe('number');
    expect(typeof risk.confidence).toBe('number');
    expect(risk.firstObservedAt).toBe('2026-05-19T10:00:00.000Z');
    expect(risk.lastObservedAt).toBe('2026-05-21T10:00:00.000Z');

    expect(result.ideaClusters).toHaveLength(1);
    const cluster = result.ideaClusters[0]!;
    expect(cluster.id).toBe('cl1');
    expect(cluster.ideaIds).toEqual(['i1', 'i2']);
    expect(cluster.clusterWeight).toBe(12.5);
    expect(typeof cluster.clusterWeight).toBe('number');
    expect(cluster.createdAt).toBe('2026-05-18T10:00:00.000Z');
  });

  it('пустой результат даёт пустые массивы, не null', async () => {
    const { prisma, opsDashboard } = buildDeps({
      insights: [],
      clusters: [],
      frictionItems: [],
      blockerItems: [],
    });
    const result = await collectWindowSignals({
      prisma: prisma as never,
      opsDashboard: opsDashboard as unknown as OperationsDashboardService,
      tenantId: 't1',
      from: FROM,
      to: TO,
    });

    expect(result.risksByCause).toEqual([]);
    expect(result.ideaClusters).toEqual([]);
    expect(result.teamFrictions).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.risksByCause).toHaveLength(0);
    expect(result.ideaClusters).toHaveLength(0);
    expect(result.teamFrictions).toHaveLength(0);
    expect(result.blockers).toHaveLength(0);
  });
});
