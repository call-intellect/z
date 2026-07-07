import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { LlmCostDashboardService } from './llm-cost-dashboard.service';

interface FixtureRow {
  tenantId: string;
  date: Date;
  taskType: string;
  provider: string;
  model: string;
  costUsd: number;
  callsCount: number;
}

interface OrgFixture {
  id: string;
  name: string;
  slug: string;
}

function utcDate(daysAgo: number): Date {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(today.getTime() - daysAgo * 86_400_000);
}

function matchesWhere(row: FixtureRow, where: Record<string, unknown>): boolean {
  for (const key of Object.keys(where)) {
    const expected = where[key];
    if (key === 'date' && expected && typeof expected === 'object') {
      const d = expected as { gte?: Date; lt?: Date };
      if (d.gte && row.date < d.gte) return false;
      if (d.lt && row.date >= d.lt) return false;
      continue;
    }
    if (expected && typeof expected === 'object' && 'in' in expected) {
      const list = (expected as { in: string[] }).in;
      const value = (row as unknown as Record<string, string>)[key] ?? '';
      if (!list.includes(value)) return false;
      continue;
    }
    if ((row as unknown as Record<string, unknown>)[key] !== expected) return false;
  }
  return true;
}

interface SubscriptionChargeFixture {
  chargeDate: Date;
  amountUsd: number;
}

function build(
  rows: FixtureRow[] = [],
  orgs: OrgFixture[] = [],
  subscriptionCharges: SubscriptionChargeFixture[] = [],
) {
  const groupBy = vi.fn(
    async (args: { by: string[]; where: Record<string, unknown> }) => {
      const filtered = rows.filter((r) => matchesWhere(r, args.where));
      const keys = args.by as Array<'date' | 'model' | 'taskType' | 'tenantId' | 'provider'>;
      const groups = new Map<
        string,
        { costUsd: number; callsCount: number; raw: Record<string, unknown> }
      >();
      for (const r of filtered) {
        const raw: Record<string, unknown> = {};
        for (const key of keys) {
          raw[key] =
            key === 'date' ? r.date : (r as unknown as Record<string, string>)[key];
        }
        const mapKey = keys
          .map((key) => (key === 'date' ? (raw[key] as Date).toISOString() : (raw[key] as string)))
          .join('::');
        const g = groups.get(mapKey) ?? { costUsd: 0, callsCount: 0, raw };
        g.costUsd += r.costUsd;
        g.callsCount += r.callsCount;
        groups.set(mapKey, g);
      }
      const result = [...groups.values()].map((g) => ({
        ...g.raw,
        _sum: { costUsd: new Prisma.Decimal(g.costUsd), callsCount: g.callsCount },
      }));
      return result as unknown[];
    },
  );

  const aggregate = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const filtered = rows.filter((r) => matchesWhere(r, args.where));
    const costUsd = filtered.reduce((sum, r) => sum + r.costUsd, 0);
    const callsCount = filtered.reduce((sum, r) => sum + r.callsCount, 0);
    return { _sum: { costUsd: new Prisma.Decimal(costUsd), callsCount } };
  });

  const orgFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    if (args?.where?.id && typeof args.where.id === 'object' && 'in' in args.where.id) {
      const ids = (args.where.id as { in: string[] }).in;
      return orgs.filter((o) => ids.includes(o.id));
    }
    if (args?.where?.OR) {
      const clauses = args.where.OR as Array<{
        name?: { contains: string };
        slug?: { contains: string };
      }>;
      return orgs.filter((o) =>
        clauses.some((c) => {
          if (c.name) return o.name.toLowerCase().includes(c.name.contains.toLowerCase());
          if (c.slug) return o.slug.toLowerCase().includes(c.slug.contains.toLowerCase());
          return false;
        }),
      );
    }
    return orgs;
  });

  const orgFindUnique = vi.fn(async (args: { where: { id: string } }) => {
    return orgs.find((o) => o.id === args.where.id) ?? null;
  });

  const subscriptionChargeFindMany = vi.fn(
    async (args: { where: { chargeDate: { gte: Date; lt: Date } } }) =>
      subscriptionCharges
        .filter(
          (c) => c.chargeDate >= args.where.chargeDate.gte && c.chargeDate < args.where.chargeDate.lt,
        )
        .map((c) => ({ chargeDate: c.chargeDate, amountUsd: new Prisma.Decimal(c.amountUsd) })),
  );
  const prisma = {
    aiCostDaily: { groupBy, aggregate },
    org: { findMany: orgFindMany, findUnique: orgFindUnique },
    llmProviderSubscriptionCharge: { findMany: subscriptionChargeFindMany },
  } as unknown as PrismaService;

  const svc = new LlmCostDashboardService(prisma);
  return { svc, prisma, groupBy, aggregate, subscriptionChargeFindMany };
}

describe('LlmCostDashboardService', () => {
  const rows: FixtureRow[] = [
    {
      tenantId: 'org-1',
      date: utcDate(2),
      taskType: 'summary',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      costUsd: 100,
      callsCount: 10,
    },
    {
      tenantId: 'org-1',
      date: utcDate(1),
      taskType: 'chat',
      provider: 'openai-via-proxy',
      model: 'gpt-5.5',
      costUsd: 50,
      callsCount: 5,
    },
    {
      tenantId: 'org-2',
      date: utcDate(1),
      taskType: 'block-ingest',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      costUsd: 25,
      callsCount: 2,
    },
  ];
  const orgs: OrgFixture[] = [
    { id: 'org-1', name: 'Org One', slug: 'org-one' },
    { id: 'org-2', name: 'Org Two', slug: 'org-two' },
  ];

  describe('overview', () => {
    it('верно считает суммы/доли/тренд по фикстуре из 3 строк (2 модели, 2 модуля через 2 taskType, 2 компании)', async () => {
      const { svc } = build(rows, orgs);
      const res = await svc.overview({ period: '30d', trend: 'day' });

      expect(res.totals.costUsd).toBe(175);
      expect(res.totals.callsCount).toBe(17);

      expect(res.byModel).toHaveLength(2);
      const deepseek = res.byModel.find((m) => m.model === 'deepseek-v4-pro');
      const gpt = res.byModel.find((m) => m.model === 'gpt-5.5');
      expect(deepseek?.provider).toBe('deepseek');
      expect(deepseek?.costUsd).toBe(125);
      expect(deepseek?.sharePct).toBeCloseTo((125 / 175) * 100);
      expect(gpt?.provider).toBe('openai-via-proxy');
      expect(gpt?.costUsd).toBe(50);
      expect(gpt?.sharePct).toBeCloseTo((50 / 175) * 100);

      // summary + block-ingest -> extraction; chat -> agent
      expect(res.byModule.length).toBeGreaterThanOrEqual(2);
      const extraction = res.byModule.find((m) => m.module === 'extraction');
      const agent = res.byModule.find((m) => m.module === 'agent');
      expect(extraction?.costUsd).toBe(125);
      expect(agent?.costUsd).toBe(50);

      expect(res.topCompanies).toHaveLength(2);
      const org1 = res.topCompanies.find((c) => c.tenantId === 'org-1');
      const org2 = res.topCompanies.find((c) => c.tenantId === 'org-2');
      expect(org1?.costUsd).toBe(150);
      expect(org1?.name).toBe('Org One');
      expect(org2?.costUsd).toBe(25);
      expect(org2?.name).toBe('Org Two');

      expect(res.trend.length).toBeGreaterThan(0);
      const trendTotal = res.trend.reduce((sum, p) => sum + p.costUsd, 0);
      expect(trendTotal).toBe(175);
      expect(res.totals.subscriptionCostUsd).toBe(0);
    });

    it('подписочное списание провайдера (ТЗ 2026-07-06 llm-provider-subscription-billing) добавляется в totals.costUsd/trend, выделено в totals.subscriptionCostUsd', async () => {
      const chargeDate = utcDate(1);
      const { svc } = build(rows, orgs, [{ chargeDate, amountUsd: 50 }]);
      const res = await svc.overview({ period: '30d', trend: 'day' });

      expect(res.totals.costUsd).toBe(225);
      expect(res.totals.subscriptionCostUsd).toBe(50);
      const trendTotal = res.trend.reduce((sum, p) => sum + p.costUsd, 0);
      expect(trendTotal).toBe(225);
      const chargeDayPoint = res.trend.find(
        (p) => p.date === chargeDate.toISOString().slice(0, 10),
      );
      expect(chargeDayPoint?.costUsd).toBe(125);
    });

    it('dateFrom/dateTo (произвольный диапазон) переопределяют period — захватывает только строки внутри диапазона', async () => {
      const { svc } = build(rows, orgs);
      const day = utcDate(2).toISOString().slice(0, 10);
      const res = await svc.overview({
        period: '30d',
        trend: 'day',
        dateFrom: day,
        dateTo: day,
      });

      expect(res.totals.costUsd).toBe(100);
      expect(res.dateFrom).toBe(day);
      expect(res.dateTo).toBe(day);
      expect(res.byModel).toHaveLength(1);
      expect(res.byModel[0]?.model).toBe('deepseek-v4-pro');
    });

    it('без dateFrom/dateTo возвращает dateFrom/dateTo, соответствующие резолву period', async () => {
      const { svc } = build(rows, orgs);
      const res = await svc.overview({ period: '7d', trend: 'day' });

      expect(res.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(res.dateFrom).getTime()).toBeLessThan(new Date(res.dateTo).getTime());
    });
  });

  describe('companyDetail', () => {
    it('для несуществующего tenantId возвращает totals.costUsd===0, пустые массивы, не бросает', async () => {
      const { svc } = build(rows, orgs);
      const res = await svc.companyDetail('org-does-not-exist', { period: '30d', trend: 'day' });

      expect(res.totals.costUsd).toBe(0);
      expect(res.byModel).toEqual([]);
      expect(res.trend).toEqual([]);
      expect(res.name).toBe('org-does-not-exist');
    });

    it('для существующего tenantId агрегирует по модели', async () => {
      const { svc } = build(rows, orgs);
      const res = await svc.companyDetail('org-1', { period: '30d', trend: 'day' });

      expect(res.totals.costUsd).toBe(150);
      expect(res.name).toBe('Org One');
      expect(res.byModel).toHaveLength(2);
      expect(res.byModel.find((m) => m.model === 'deepseek-v4-pro')?.provider).toBe('deepseek');
      expect(res.byModel.find((m) => m.model === 'gpt-5.5')?.provider).toBe('openai-via-proxy');
    });

    it('dateFrom/dateTo (произвольный диапазон) переопределяют period — захватывает только строки внутри диапазона', async () => {
      const { svc } = build(rows, orgs);
      const day = utcDate(2).toISOString().slice(0, 10);
      const res = await svc.companyDetail('org-1', {
        period: '30d',
        trend: 'day',
        dateFrom: day,
        dateTo: day,
      });

      expect(res.totals.costUsd).toBe(100);
      expect(res.byModel).toHaveLength(1);
      expect(res.byModel[0]?.model).toBe('deepseek-v4-pro');
    });

    it('provider/model фильтр сужает выборку до конкретной пары', async () => {
      const { svc } = build(rows, orgs);
      const res = await svc.companyDetail('org-1', {
        period: '30d',
        trend: 'day',
        provider: 'openai-via-proxy',
      });

      expect(res.totals.costUsd).toBe(50);
      expect(res.byModel).toHaveLength(1);
      expect(res.byModel[0]?.model).toBe('gpt-5.5');
    });

    it('одинаковое имя модели у РАЗНЫХ провайдеров (напр. gemini-3.1-pro через kie и grsai) → две отдельные строки byModel, не смёржены', async () => {
      const ambiguousRows: FixtureRow[] = [
        {
          tenantId: 'org-1',
          date: utcDate(1),
          taskType: 'summary',
          provider: 'kie',
          model: 'gemini-3.1-pro',
          costUsd: 10,
          callsCount: 1,
        },
        {
          tenantId: 'org-1',
          date: utcDate(1),
          taskType: 'summary',
          provider: 'grsai',
          model: 'gemini-3.1-pro',
          costUsd: 20,
          callsCount: 1,
        },
      ];
      const { svc } = build(ambiguousRows, orgs);
      const res = await svc.companyDetail('org-1', { period: '30d', trend: 'day' });

      expect(res.byModel).toHaveLength(2);
      expect(res.byModel.find((m) => m.provider === 'kie')?.costUsd).toBe(10);
      expect(res.byModel.find((m) => m.provider === 'grsai')?.costUsd).toBe(20);
    });
  });

  describe('moduleDetail', () => {
    it("агрегирует taskType с модулем 'other', включая заведомо отсутствующий в карте taskType (fallback)", async () => {
      const rowsWithUnmapped: FixtureRow[] = [
        ...rows,
        {
          tenantId: 'org-1',
          date: utcDate(1),
          taskType: 'totally-unknown-task-type-not-in-map',
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          costUsd: 10,
          callsCount: 1,
        },
      ];
      const { svc } = build(rowsWithUnmapped, orgs);
      const res = await svc.moduleDetail('other', { period: '30d', trend: 'day' });

      expect(res.module).toBe('other');
      expect(res.totals.costUsd).toBe(10);
      const unmapped = res.byTaskType.find(
        (t) => t.taskType === 'totally-unknown-task-type-not-in-map',
      );
      expect(unmapped?.costUsd).toBe(10);
      expect(unmapped?.callsCount).toBe(1);
    });

    it("module='extraction' агрегирует summary + block-ingest", async () => {
      const { svc } = build(rows, orgs);
      const res = await svc.moduleDetail('extraction', { period: '30d', trend: 'day' });

      expect(res.totals.costUsd).toBe(125);
      expect(res.byTaskType.map((t) => t.taskType).sort()).toEqual(['block-ingest', 'summary']);
    });
  });
});
