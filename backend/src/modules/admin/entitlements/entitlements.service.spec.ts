/**
 * Admin-redesign Фаза 4 — unit-тесты `AdminEntitlementsService`.
 *
 * Покрываем:
 *   1) listOverview(hasOverrides=true): фильтрует только Org с override'ами.
 *   2) listOverview(hasOverrides=false): возвращает все OrgEntitlement.
 *   3) upsertForOrg(): создаёт OrgEntitlement, если записи нет.
 *   4) upsertForOrg(): обновляет существующую запись.
 *   5) removeFeatureKey(): удаляет ключ из featureOverrides.
 *   6) removeFeatureKey(): removed=false если ключа не было.
 *   7) resolveForOrg(): plan.features ∪ overrides с приоритетом override.
 */

import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminEntitlementsService } from './entitlements.service';

interface EntRow {
  id: string;
  tenantId: string;
  tier: string;
  featureOverrides: unknown;
  quotaOverrides: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  org: { id: string; name: string; slug: string } | null;
}

interface PlanRow {
  id: string;
  displayName: string;
  features: unknown;
  quotas: unknown;
  isActive: boolean;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
}

function buildPrisma(state: { ents: EntRow[]; plans: PlanRow[]; orgs: OrgRow[] }): PrismaService {
  const orgFindUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    return state.orgs.find((o) => o.id === where.id) ?? null;
  });

  const planFindUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    return state.plans.find((p) => p.id === where.id) ?? null;
  });

  const entFindMany = vi.fn(
    async (args: {
      where?: { tier?: string };
      take?: number;
    }) => {
      let rows = [...state.ents];
      if (args.where?.tier) rows = rows.filter((r) => r.tier === args.where!.tier);
      rows.sort((a, b) => {
        const t = b.updatedAt.getTime() - a.updatedAt.getTime();
        if (t !== 0) return t;
        return b.id.localeCompare(a.id);
      });
      return rows.slice(0, args.take ?? rows.length);
    },
  );

  const entFindUnique = vi.fn(async ({ where }: { where: { tenantId: string } }) => {
    return state.ents.find((e) => e.tenantId === where.tenantId) ?? null;
  });

  const entUpsert = vi.fn(
    async (args: {
      where: { tenantId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const idx = state.ents.findIndex((e) => e.tenantId === args.where.tenantId);
      if (idx < 0) {
        const tenantId = args.where.tenantId;
        const created = args.create as Record<string, unknown>;
        const row: EntRow = {
          id: `ent-${tenantId}`,
          tenantId,
          tier: (created.tier as string) ?? 'tier_pro',
          featureOverrides: 'featureOverrides' in created ? created.featureOverrides : null,
          quotaOverrides: 'quotaOverrides' in created ? created.quotaOverrides : null,
          notes: (created.notes as string | null) ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          org: state.orgs.find((o) => o.id === tenantId) ?? null,
        };
        state.ents.push(row);
        return row;
      }
      const row = state.ents[idx]!;
      const upd = args.update;
      if ('tier' in upd) row.tier = upd.tier as string;
      if ('featureOverrides' in upd) row.featureOverrides = upd.featureOverrides;
      if ('quotaOverrides' in upd) row.quotaOverrides = upd.quotaOverrides;
      if ('notes' in upd) row.notes = (upd.notes as string | null) ?? null;
      row.updatedAt = new Date();
      return row;
    },
  );

  const entUpdate = vi.fn(
    async (args: { where: { tenantId: string }; data: Record<string, unknown> }) => {
      const row = state.ents.find((e) => e.tenantId === args.where.tenantId);
      if (!row) throw new Error('not found');
      if ('featureOverrides' in args.data) row.featureOverrides = args.data.featureOverrides;
      if ('quotaOverrides' in args.data) row.quotaOverrides = args.data.quotaOverrides;
      row.updatedAt = new Date();
      return row;
    },
  );

  return {
    org: { findUnique: orgFindUnique },
    plan: { findUnique: planFindUnique },
    orgEntitlement: {
      findMany: entFindMany,
      findUnique: entFindUnique,
      upsert: entUpsert,
      update: entUpdate,
    },
  } as unknown as PrismaService;
}

function makeEnt(over: Partial<EntRow>): EntRow {
  const tenantId = over.tenantId ?? 'tenant-1';
  return {
    id: over.id ?? `ent-${tenantId}`,
    tenantId,
    tier: over.tier ?? 'tier_pro',
    featureOverrides: over.featureOverrides ?? null,
    quotaOverrides: over.quotaOverrides ?? null,
    notes: over.notes ?? null,
    createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: over.updatedAt ?? new Date('2026-05-25T10:00:00Z'),
    org:
      over.org === undefined
        ? { id: tenantId, name: `Org ${tenantId}`, slug: `org-${tenantId}` }
        : over.org,
  };
}

describe('AdminEntitlementsService', () => {
  it('listOverview(hasOverrides=true): фильтрует только Org с override', async () => {
    const state = {
      orgs: [],
      plans: [],
      ents: [
        makeEnt({
          tenantId: 't1',
          featureOverrides: { ai_chat: false },
        }),
        makeEnt({ tenantId: 't2' }),
        makeEnt({
          tenantId: 't3',
          quotaOverrides: { max_meetings_per_day: 999 },
        }),
      ],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.listOverview({ hasOverrides: true, limit: 50 });
    expect(res.items.length).toBe(2);
    expect(res.items.map((i) => i.tenantId).sort()).toEqual(['t1', 't3']);
  });

  it('listOverview(hasOverrides=false): возвращает все OrgEntitlement', async () => {
    const state = {
      orgs: [],
      plans: [],
      ents: [
        makeEnt({ tenantId: 't1', featureOverrides: { ai_chat: false } }),
        makeEnt({ tenantId: 't2' }),
      ],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.listOverview({ hasOverrides: false, limit: 50 });
    expect(res.items.length).toBe(2);
  });

  it('upsertForOrg(): создаёт запись, если нет', async () => {
    const state: { orgs: OrgRow[]; plans: PlanRow[]; ents: EntRow[] } = {
      orgs: [{ id: 'tenant-1', name: 'A', slug: 'a' }],
      plans: [],
      ents: [],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.upsertForOrg('tenant-1', {
      tier: 'tier_pro',
      featureOverrides: { ai_chat: true },
      notes: 'промо',
    });
    expect(res.ok).toBe(true);
    expect(res.tier).toBe('tier_pro');
    expect(state.ents.length).toBe(1);
    expect(state.ents[0]?.notes).toBe('промо');
  });

  it('upsertForOrg(): NotFoundException если Org не существует', async () => {
    const svc = new AdminEntitlementsService(
      buildPrisma({ orgs: [], plans: [], ents: [] }),
    );
    await expect(svc.upsertForOrg('missing', { tier: 'tier_pro' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('upsertForOrg(): обновляет существующую запись', async () => {
    const state = {
      orgs: [{ id: 'tenant-1', name: 'A', slug: 'a' }],
      plans: [],
      ents: [makeEnt({ tenantId: 'tenant-1', tier: 'tier_basic' })],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.upsertForOrg('tenant-1', { tier: 'tier_pro' });
    expect(res.tier).toBe('tier_pro');
    expect(state.ents[0]?.tier).toBe('tier_pro');
    expect(state.ents.length).toBe(1);
  });

  it('removeFeatureKey(): удаляет ключ из featureOverrides', async () => {
    const state = {
      orgs: [],
      plans: [],
      ents: [
        makeEnt({
          tenantId: 'tenant-1',
          featureOverrides: { ai_chat: false, employee_clones: true },
        }),
      ],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.removeFeatureKey('tenant-1', 'ai_chat');
    expect(res.removed).toBe(true);
    expect(state.ents[0]?.featureOverrides).toEqual({ employee_clones: true });
  });

  it('removeFeatureKey(): removed=false если ключа не было', async () => {
    const state = {
      orgs: [],
      plans: [],
      ents: [
        makeEnt({
          tenantId: 'tenant-1',
          featureOverrides: { ai_chat: false },
        }),
      ],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.removeFeatureKey('tenant-1', 'unknown_key');
    expect(res.removed).toBe(false);
  });

  it('resolveForOrg(): plan.features ∪ overrides; override побеждает', async () => {
    const state = {
      orgs: [{ id: 'tenant-1', name: 'A', slug: 'a' }],
      plans: [
        {
          id: 'tier_pro',
          displayName: 'Pro',
          features: { ai_chat: true, employee_clones: true },
          quotas: { max_meetings_per_day: 100 },
          isActive: true,
        },
      ],
      ents: [
        makeEnt({
          tenantId: 'tenant-1',
          tier: 'tier_pro',
          // override фичи и quota.
          featureOverrides: { ai_chat: false, custom_thing: true },
          quotaOverrides: { max_meetings_per_day: 9999 },
        }),
      ],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.resolveForOrg('tenant-1');
    expect(res.tier).toBe('tier_pro');
    expect(res.features).toEqual({
      ai_chat: false, // override
      employee_clones: true, // из плана
      custom_thing: true, // только в overrides
    });
    expect(res.quotas).toEqual({ max_meetings_per_day: 9999 });
    expect(res.plan?.id).toBe('tier_pro');
  });

  it('resolveForOrg(): NotFoundException если Org нет', async () => {
    const svc = new AdminEntitlementsService(
      buildPrisma({ orgs: [], plans: [], ents: [] }),
    );
    await expect(svc.resolveForOrg('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveForOrg(): plan=null если tier не найден среди Plan', async () => {
    const state = {
      orgs: [{ id: 'tenant-1', name: 'A', slug: 'a' }],
      plans: [],
      ents: [makeEnt({ tenantId: 'tenant-1', tier: 'tier_legacy' })],
    };
    const svc = new AdminEntitlementsService(buildPrisma(state));
    const res = await svc.resolveForOrg('tenant-1');
    expect(res.plan).toBeNull();
    expect(res.tier).toBe('tier_legacy');
    expect(res.features).toEqual({});
  });
});
