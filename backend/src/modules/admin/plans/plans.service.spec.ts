/**
 * Admin-redesign Фаза 4 — unit-тесты `AdminPlansService`.
 *
 * Покрываем:
 *   1) list(): возвращает Plan'ы + считает Org по tier.
 *   2) create(): создаёт Plan; 400 если id занят.
 *   3) update(): обновляет partial-поля.
 *   4) softDelete(): isActive=false; не блокируется наличием Org.
 *   5) hardDelete(): 400 если есть Org с tier === id.
 *   6) getUsage(): возвращает Plan + список Org + общий count.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminPlansService } from './plans.service';

interface PlanRow {
  id: string;
  displayName: string;
  description: string | null;
  features: unknown;
  quotas: unknown;
  monthlyPriceRub: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EntRow {
  tenantId: string;
  tier: string;
  org: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    _count: { memberships: number; meetings: number };
  } | null;
  createdAt: Date;
}

function buildPrisma(state: { plans: PlanRow[]; ents: EntRow[] }): PrismaService {
  const planFindUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    return state.plans.find((p) => p.id === where.id) ?? null;
  });
  const planFindMany = vi.fn(async (_args: unknown) => {
    void _args;
    return [...state.plans].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  });
  const planCreate = vi.fn(async ({ data }: { data: Partial<PlanRow> & { id: string } }) => {
    const row: PlanRow = {
      id: data.id,
      displayName: data.displayName ?? '',
      description: data.description ?? null,
      features: data.features ?? {},
      quotas: data.quotas ?? {},
      monthlyPriceRub: data.monthlyPriceRub ?? null,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    state.plans.push(row);
    return row;
  });
  const planUpdate = vi.fn(
    async ({ where, data }: { where: { id: string }; data: Partial<PlanRow> }) => {
      const p = state.plans.find((x) => x.id === where.id);
      if (!p) throw new Error('not found');
      Object.assign(p, data, { updatedAt: new Date() });
      return p;
    },
  );
  const planDelete = vi.fn(async ({ where }: { where: { id: string } }) => {
    const idx = state.plans.findIndex((x) => x.id === where.id);
    if (idx < 0) throw new Error('not found');
    const [removed] = state.plans.splice(idx, 1);
    return removed;
  });

  const entGroupBy = vi.fn(async () => {
    const buckets = new Map<string, number>();
    for (const e of state.ents) {
      buckets.set(e.tier, (buckets.get(e.tier) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([tier, count]) => ({
      tier,
      _count: { _all: count },
    }));
  });
  const entCount = vi.fn(async ({ where }: { where: { tier: string } }) => {
    return state.ents.filter((e) => e.tier === where.tier).length;
  });
  const entFindMany = vi.fn(
    async (args: { where: { tier: string }; take?: number }) => {
      const rows = state.ents.filter((e) => e.tier === args.where.tier).slice(0, args.take ?? 10);
      return rows;
    },
  );

  return {
    plan: {
      findUnique: planFindUnique,
      findMany: planFindMany,
      create: planCreate,
      update: planUpdate,
      delete: planDelete,
    },
    orgEntitlement: {
      groupBy: entGroupBy,
      count: entCount,
      findMany: entFindMany,
    },
  } as unknown as PrismaService;
}

function makePlan(over: Partial<PlanRow>): PlanRow {
  return {
    id: over.id ?? 'tier_basic',
    displayName: over.displayName ?? 'Basic',
    description: over.description ?? null,
    features: over.features ?? {},
    quotas: over.quotas ?? {},
    monthlyPriceRub: over.monthlyPriceRub ?? null,
    isActive: over.isActive ?? true,
    sortOrder: over.sortOrder ?? 0,
    createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: over.updatedAt ?? new Date('2026-01-01T00:00:00Z'),
  };
}

function makeEnt(over: Partial<EntRow>): EntRow {
  return {
    tenantId: over.tenantId ?? 'tenant-1',
    tier: over.tier ?? 'tier_basic',
    org: over.org ?? {
      id: over.tenantId ?? 'tenant-1',
      name: 'Org 1',
      slug: 'org-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      _count: { memberships: 3, meetings: 10 },
    },
    createdAt: over.createdAt ?? new Date(),
  };
}

describe('AdminPlansService', () => {
  it('list(): возвращает Plan + считает Org по tier', async () => {
    const prisma = buildPrisma({
      plans: [
        makePlan({ id: 'tier_basic', sortOrder: 1 }),
        makePlan({ id: 'tier_pro', sortOrder: 2 }),
      ],
      ents: [
        makeEnt({ tenantId: 't1', tier: 'tier_basic' }),
        makeEnt({ tenantId: 't2', tier: 'tier_basic' }),
        makeEnt({ tenantId: 't3', tier: 'tier_pro' }),
      ],
    });
    const svc = new AdminPlansService(prisma);
    const res = await svc.list();
    expect(res.items.length).toBe(2);
    expect(res.items[0]?.id).toBe('tier_basic');
    expect(res.items[0]?.orgsCount).toBe(2);
    expect(res.items[1]?.orgsCount).toBe(1);
  });

  it('create(): создаёт Plan; 400 если id занят', async () => {
    const state = {
      plans: [makePlan({ id: 'tier_basic' })],
      ents: [],
    };
    const svc = new AdminPlansService(buildPrisma(state));
    await expect(
      svc.create({
        id: 'tier_basic',
        displayName: 'Dup',
        features: {},
        quotas: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const created = await svc.create({
      id: 'tier_team',
      displayName: 'Team',
      features: { ai_chat: true },
      quotas: { max_meetings_per_day: 100 },
      monthlyPriceRub: 5000,
      sortOrder: 5,
    });
    expect(created.id).toBe('tier_team');
    expect(created.monthlyPriceRub).toBe(5000);
    expect(state.plans.length).toBe(2);
  });

  it('update(): обновляет partial-поля + считает orgsCount', async () => {
    const state = {
      plans: [makePlan({ id: 'tier_pro', displayName: 'Pro' })],
      ents: [makeEnt({ tier: 'tier_pro' })],
    };
    const svc = new AdminPlansService(buildPrisma(state));
    const upd = await svc.update('tier_pro', {
      displayName: 'Pro+',
      monthlyPriceRub: 12000,
    });
    expect(upd.displayName).toBe('Pro+');
    expect(upd.monthlyPriceRub).toBe(12000);
    expect(upd.orgsCount).toBe(1);
  });

  it('update(): NotFoundException для несуществующего id', async () => {
    const svc = new AdminPlansService(buildPrisma({ plans: [], ents: [] }));
    await expect(svc.update('missing', { displayName: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('softDelete(): isActive=false; не блокируется наличием Org', async () => {
    const state = {
      plans: [makePlan({ id: 'tier_basic', isActive: true })],
      ents: [makeEnt({ tier: 'tier_basic' })],
    };
    const svc = new AdminPlansService(buildPrisma(state));
    const res = await svc.softDelete('tier_basic');
    expect(res.ok).toBe(true);
    expect(state.plans[0]?.isActive).toBe(false);
  });

  it('hardDelete(): 400 если есть Org с tier === id', async () => {
    const state = {
      plans: [makePlan({ id: 'tier_basic' })],
      ents: [makeEnt({ tier: 'tier_basic' })],
    };
    const svc = new AdminPlansService(buildPrisma(state));
    await expect(svc.hardDelete('tier_basic')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.plans.length).toBe(1);
  });

  it('hardDelete(): успех, если Org с этим tier нет', async () => {
    const state = {
      plans: [makePlan({ id: 'tier_unused' })],
      ents: [],
    };
    const svc = new AdminPlansService(buildPrisma(state));
    const res = await svc.hardDelete('tier_unused');
    expect(res.ok).toBe(true);
    expect(state.plans.length).toBe(0);
  });

  it('getUsage(): возвращает Plan + список Org + общий count', async () => {
    const state = {
      plans: [makePlan({ id: 'tier_pro' })],
      ents: [
        makeEnt({ tenantId: 't1', tier: 'tier_pro' }),
        makeEnt({ tenantId: 't2', tier: 'tier_pro' }),
      ],
    };
    const svc = new AdminPlansService(buildPrisma(state));
    const res = await svc.getUsage('tier_pro');
    expect(res.plan.id).toBe('tier_pro');
    expect(res.orgsCount).toBe(2);
    expect(res.items.length).toBe(2);
    expect(res.items[0]?.tenantId).toBe('t1');
  });
});
