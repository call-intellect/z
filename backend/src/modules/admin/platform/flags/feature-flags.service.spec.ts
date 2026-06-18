import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { computeRolloutHash, normalizeOrgOverrides } from './feature-flags.helpers';
import { FeatureFlagsService } from './feature-flags.service';

interface FlagRow {
  key: string;
  description: string;
  defaultValue: boolean;
  orgOverrides: Record<string, boolean>;
  rolloutPercent: number | null;
  category: string;
  updatedBy: string | null;
  updatedAt: Date;
}

function buildService(initial: { rows?: FlagRow[] } = {}) {
  const rows: FlagRow[] = [...(initial.rows ?? [])];
  const findUnique = vi.fn(async (args: { where: { key: string } }) => {
    return rows.find((r) => r.key === args.where.key) ?? null;
  });
  const findMany = vi.fn(async () => [...rows]);
  const create = vi.fn(async (args: { data: Omit<FlagRow, 'updatedAt'> }) => {
    const row: FlagRow = {
      ...args.data,
      orgOverrides: normalizeOrgOverrides(args.data.orgOverrides),
      updatedAt: new Date('2026-05-25T12:00:00Z'),
    };
    rows.push(row);
    return row;
  });
  const update = vi.fn(async (args: { where: { key: string }; data: Partial<FlagRow> }) => {
    const idx = rows.findIndex((r) => r.key === args.where.key);
    if (idx < 0) throw new Error('not found');
    const cur = rows[idx]!;
    const next: FlagRow = {
      ...cur,
      ...args.data,
      orgOverrides:
        args.data.orgOverrides !== undefined
          ? normalizeOrgOverrides(args.data.orgOverrides)
          : cur.orgOverrides,
      updatedAt: new Date('2026-05-25T13:00:00Z'),
    };
    rows[idx] = next;
    return next;
  });
  const del = vi.fn(async (args: { where: { key: string } }) => {
    const idx = rows.findIndex((r) => r.key === args.where.key);
    if (idx < 0) throw new Error('not found');
    const removed = rows[idx]!;
    rows.splice(idx, 1);
    return removed;
  });

  const prisma = {
    featureFlag: { findUnique, findMany, create, update, delete: del },
  } as unknown as PrismaService;

  const svc = new FeatureFlagsService(prisma);
  return { svc, rows };
}

describe('FeatureFlagsService', () => {
  it('create(): INSERT при отсутствии записи; Conflict при дубле', async () => {
    const { svc } = buildService();
    const created = await svc.create({
      key: 'ai.preview-v2',
      description: 'preview',
      defaultValue: false,
      category: 'ai',
      userId: 'super-1',
    });
    expect(created.key).toBe('ai.preview-v2');
    expect(created.defaultValue).toBe(false);
    await expect(
      svc.create({
        key: 'ai.preview-v2',
        description: 'duplicate',
        defaultValue: true,
        category: 'ai',
        userId: 'super-1',
      }),
    ).rejects.toThrow();
  });

  it('resolve(): orgOverride принимает решение (false), даже если default=true', async () => {
    const { svc } = buildService({
      rows: [
        {
          key: 'feat.x',
          description: 'x',
          defaultValue: true,
          orgOverrides: { 'tenant-bad': false, 'tenant-good': true },
          rolloutPercent: null,
          category: 'experimental',
          updatedBy: null,
          updatedAt: new Date(),
        },
      ],
    });
    const a = await svc.resolve('feat.x', 'tenant-bad');
    expect(a.value).toBe(false);
    expect(a.source).toBe('override');
    const b = await svc.resolve('feat.x', 'tenant-other');
    expect(b.value).toBe(true);
    expect(b.source).toBe('default');
  });

  it('resolve(): rolloutPercent распределяет по hash, 0%/100% — крайние случаи', async () => {
    const { svc } = buildService({
      rows: [
        {
          key: 'feat.r',
          description: 'r',
          defaultValue: false,
          orgOverrides: {},
          rolloutPercent: 100,
          category: 'experimental',
          updatedBy: null,
          updatedAt: new Date(),
        },
      ],
    });
    const all = await svc.resolve('feat.r', 'tenant-any');
    expect(all.value).toBe(true);
    expect(all.source).toBe('rollout');

    await svc.update({
      key: 'feat.r',
      patch: { rolloutPercent: 0 },
      userId: 'super-1',
    });
    const none = await svc.resolve('feat.r', 'tenant-any');
    expect(none.value).toBe(false);

    await svc.update({
      key: 'feat.r',
      patch: { rolloutPercent: 50 },
      userId: 'super-1',
    });
    let trues = 0;
    let falses = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = await svc.resolve('feat.r', `tenant-${i}`);
      if (r.value) trues += 1;
      else falses += 1;
    }
    expect(trues).toBeGreaterThan(0);
    expect(falses).toBeGreaterThan(0);
  });

  it('computeRolloutHash(): детерминированная функция', () => {
    const a = computeRolloutHash('feat.k', 'tenant-1');
    const b = computeRolloutHash('feat.k', 'tenant-1');
    const c = computeRolloutHash('feat.k', 'tenant-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('setOverride/clearOverride: точечно правят orgOverrides JSON', async () => {
    const { svc, rows } = buildService({
      rows: [
        {
          key: 'feat.o',
          description: 'o',
          defaultValue: false,
          orgOverrides: {},
          rolloutPercent: null,
          category: 'experimental',
          updatedBy: null,
          updatedAt: new Date(),
        },
      ],
    });
    await svc.setOverride({
      key: 'feat.o',
      tenantId: 'tenant-1',
      value: true,
      userId: 'super-1',
    });
    expect(rows[0]?.orgOverrides['tenant-1']).toBe(true);

    const resolved = await svc.resolve('feat.o', 'tenant-1');
    expect(resolved.value).toBe(true);
    expect(resolved.source).toBe('override');

    await svc.clearOverride({
      key: 'feat.o',
      tenantId: 'tenant-1',
      userId: 'super-1',
    });
    expect(rows[0]?.orgOverrides['tenant-1']).toBeUndefined();
  });
});
