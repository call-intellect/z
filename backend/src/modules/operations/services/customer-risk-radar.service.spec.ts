import { describe, expect, it, vi } from 'vitest';

import { CustomerRiskRadarService } from './customer-risk-radar.service';

describe('CustomerRiskRadarService', () => {
  const dateLocal = '2026-06-07';

  function buildCfg(overrides?: Record<string, unknown>) {
    const map: Record<string, unknown> = {
      'customer_risk.window_days': 14,
      'customer_risk.weight.churn_risk': 5,
      'customer_risk.weight.objection': 3,
      'customer_risk.weight.pain': 2,
      'customer_risk.weight.feature_request': 1,
      'customer_risk.threshold.critical': 10,
      'customer_risk.threshold.warning': 4,
      ...overrides,
    };
    return {
      getDynamic: vi.fn(async (key: string, _env: string, def: unknown) =>
        key in map ? map[key] : def,
      ),
    };
  }

  const metrics = {
    incCustomerRiskSnapshots: vi.fn(),
    incCustomerRiskRadarFailed: vi.fn(),
    incCustomerRiskManagerNotified: vi.fn(),
  };

  function build(opts: {
    blockEntities: Array<{
      entityId: string;
      entity: { canonicalName: string };
      block: {
        id: string;
        signalType: string;
        name: string;
        criticalQuestion: string;
        createdAt: Date;
      };
    }>;
    cards?: Array<{ id: string; ownerId: string | null }>;
    project?: { ownerId: string } | null;
    person?: { id: string } | null;
    prevSnapshot?: { riskScore: number; signalCounts: unknown } | null;
    cfgOverrides?: Record<string, unknown>;
  }) {
    const upsertCalls: unknown[] = [];
    const prisma = {
      ideaBlockEntity: {
        findMany: vi.fn().mockResolvedValue(opts.blockEntities),
      },
      card: {
        findMany: vi.fn().mockResolvedValue(opts.cards ?? []),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue(opts.project ?? null),
      },
      person: {
        findFirst: vi.fn().mockResolvedValue(opts.person ?? null),
      },
      customerRiskSnapshot: {
        upsert: vi.fn(async (arg: { create?: unknown }) => {
          upsertCalls.push(arg);
          return { id: `snap-${upsertCalls.length}` };
        }),
        findUnique: vi.fn().mockResolvedValue(
          opts.prevSnapshot
            ? {
                riskScore: opts.prevSnapshot.riskScore,
                signalCounts: opts.prevSnapshot.signalCounts,
              }
            : null,
        ),
      },
    };
    const cfg = buildCfg(opts.cfgOverrides);
    const llm = { call: vi.fn() };
    const svc = new CustomerRiskRadarService(
      prisma as never,
      cfg as never,
      metrics as never,
      llm as never,
    );
    return { svc, prisma, upsertCalls };
  }

  function be(entityId: string, name: string, blockId: string, signalType: string) {
    return {
      entityId,
      entity: { canonicalName: name },
      block: {
        id: blockId,
        signalType,
        name: `block ${blockId}`,
        criticalQuestion: 'q?',
        createdAt: new Date('2026-06-06T10:00:00Z'),
      },
    };
  }

  it('группирует блоки по клиенту, считает score/level и upsert-ит снимок', async () => {
    const { svc, upsertCalls } = build({
      blockEntities: [
        be('cust-A', 'Клиент А', 'b1', 'churn_risk'),
        be('cust-A', 'Клиент А', 'b2', 'churn_risk'),
        be('cust-B', 'Клиент Б', 'b3', 'pain'),
      ],
    });

    const res = await svc.computeForTenant({ tenantId: 'org1', dateLocal });

    expect(res.snapshots).toHaveLength(2);
    expect(res.criticalCount).toBe(1);
    expect(res.warningCount).toBe(0);

    const a = res.snapshots.find((s) => s.customerEntityId === 'cust-A')!;
    expect(a.riskScore).toBe(10);
    expect(a.riskLevel).toBe('critical');
    const b = res.snapshots.find((s) => s.customerEntityId === 'cust-B')!;
    expect(b.riskScore).toBe(2);
    expect(b.riskLevel).toBe('ok');

    const createA = (upsertCalls as Array<{ create: { signalCounts: unknown } }>).find(() => true);
    expect(createA).toBeTruthy();
    expect(metrics.incCustomerRiskSnapshots).toHaveBeenCalledWith({
      level: 'critical',
    });
  });

  it('responsiblePersonId = null, когда нет карточки клиента (не выдумываем)', async () => {
    const { svc } = build({
      blockEntities: [be('cust-A', 'Клиент А', 'b1', 'churn_risk')],
      cards: [],
    });
    const res = await svc.computeForTenant({ tenantId: 'org1', dateLocal });
    expect(res.snapshots[0]!.responsiblePersonId).toBeNull();
  });

  it('responsiblePersonId резолвится через Project.owner → Person', async () => {
    const { svc } = build({
      blockEntities: [
        be('cust-A', 'Клиент А', 'b1', 'churn_risk'),
        be('cust-A', 'Клиент А', 'b2', 'churn_risk'),
      ],
      cards: [{ id: 'card-1', ownerId: 'user-owner' }],
      project: { ownerId: 'user-pm' },
      person: { id: 'person-pm' },
    });
    const res = await svc.computeForTenant({ tenantId: 'org1', dateLocal });
    expect(res.snapshots[0]!.responsiblePersonId).toBe('person-pm');
  });

  describe('computeDelta', () => {
    it('нет вчерашнего снимка → дельта = сегодняшние значения', async () => {
      const { svc } = build({ blockEntities: [], prevSnapshot: null });
      const delta = await svc.computeDelta({
        tenantId: 'org1',
        customerEntityId: 'cust-A',
        dateLocal,
        todayScore: 10,
        todayCounts: { churn_risk: 2, objection: 0, pain: 0, feature_request: 0 },
      });
      expect(delta.scoreDelta).toBe(10);
      expect(delta.signalDelta).toBe(2);
    });

    it('приток сигналов: сегодня 5, вчера 2 → signalDelta +3', async () => {
      const { svc } = build({
        blockEntities: [],
        prevSnapshot: {
          riskScore: 6,
          signalCounts: { churn_risk: 1, objection: 1, pain: 0, feature_request: 0 },
        },
      });
      const delta = await svc.computeDelta({
        tenantId: 'org1',
        customerEntityId: 'cust-A',
        dateLocal,
        todayScore: 16,
        todayCounts: { churn_risk: 2, objection: 1, pain: 2, feature_request: 0 },
      });
      expect(delta.signalDelta).toBe(3);
      expect(delta.scoreDelta).toBe(10);
    });

    it('отток сигналов: сегодня меньше → signalDelta отрицательный', async () => {
      const { svc } = build({
        blockEntities: [],
        prevSnapshot: {
          riskScore: 20,
          signalCounts: { churn_risk: 4, objection: 0, pain: 0, feature_request: 0 },
        },
      });
      const delta = await svc.computeDelta({
        tenantId: 'org1',
        customerEntityId: 'cust-A',
        dateLocal,
        todayScore: 5,
        todayCounts: { churn_risk: 1, objection: 0, pain: 0, feature_request: 0 },
      });
      expect(delta.signalDelta).toBe(-3);
      expect(delta.scoreDelta).toBe(-15);
    });
  });
});
