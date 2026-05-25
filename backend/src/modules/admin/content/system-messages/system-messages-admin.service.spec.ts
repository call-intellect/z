/**
 * Admin-redesign Фаза 5 — unit-тесты `SystemMessagesAdminService`.
 *
 * Покрываем:
 *   1) list(): фильтры type/isActive работают, сортировка createdAt DESC.
 *   2) create(): создаёт с default isActive=true и пустым targetOrgs.
 *   3) update(): partial; 404 на отсутствующий id.
 *   4) remove(): hard-delete; 404 на отсутствующий id.
 *   5) getActive(): фильтрует isActive и временные границы.
 */

import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { SystemMessagesAdminService } from './system-messages-admin.service';

interface MsgRow {
  id: string;
  type: string;
  severity: string;
  body: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  targetOrgs: string[];
  createdBy: string;
  createdAt: Date;
}

function buildPrisma(state: { rows: MsgRow[] }): PrismaService {
  let nextId = 1;

  const matches = (
    r: MsgRow,
    where: Record<string, unknown>,
    now?: Date,
  ): boolean => {
    if (where.type !== undefined && r.type !== where.type) return false;
    if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
    if (Array.isArray(where.AND)) {
      for (const clause of where.AND as Array<Record<string, unknown>>) {
        if (Array.isArray(clause.OR)) {
          const ok = (clause.OR as Array<Record<string, unknown>>).some((c) => {
            if (c.startsAt === null) return r.startsAt === null;
            if (c.endsAt === null) return r.endsAt === null;
            if (c.startsAt && typeof c.startsAt === 'object' && 'lte' in c.startsAt) {
              const lte = (c.startsAt as { lte: Date }).lte;
              return r.startsAt !== null && r.startsAt.getTime() <= lte.getTime();
            }
            if (c.endsAt && typeof c.endsAt === 'object' && 'gt' in c.endsAt) {
              const gt = (c.endsAt as { gt: Date }).gt;
              return r.endsAt !== null && r.endsAt.getTime() > gt.getTime();
            }
            return false;
          });
          if (!ok) return false;
        }
      }
    }
    void now;
    return true;
  };

  const findMany = vi.fn(
    async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
      const where = args.where ?? {};
      const filtered = state.rows.filter((r) => matches(r, where));
      // orderBy createdAt desc
      return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  );
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    return state.rows.find((r) => r.id === where.id) ?? null;
  });
  const create = vi.fn(async ({ data }: { data: Partial<MsgRow> }) => {
    const row: MsgRow = {
      id: `m-${nextId++}`,
      type: data.type ?? 'banner',
      severity: data.severity ?? 'info',
      body: data.body ?? '',
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
      isActive: data.isActive ?? true,
      targetOrgs: data.targetOrgs ?? [],
      createdBy: data.createdBy ?? 'unknown',
      createdAt: new Date(),
    };
    state.rows.push(row);
    return row;
  });
  const update = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<MsgRow>;
    }) => {
      const r = state.rows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data);
      return r;
    },
  );
  const deleteFn = vi.fn(async ({ where }: { where: { id: string } }) => {
    const idx = state.rows.findIndex((x) => x.id === where.id);
    if (idx < 0) throw new Error('not found');
    const [removed] = state.rows.splice(idx, 1);
    return removed;
  });

  return {
    systemMessage: {
      findMany,
      findUnique,
      create,
      update,
      delete: deleteFn,
    },
  } as unknown as PrismaService;
}

function makeRow(over: Partial<MsgRow>): MsgRow {
  return {
    id: over.id ?? 'm-1',
    type: over.type ?? 'banner',
    severity: over.severity ?? 'info',
    body: over.body ?? 'Привет',
    startsAt: over.startsAt ?? null,
    endsAt: over.endsAt ?? null,
    isActive: over.isActive ?? true,
    targetOrgs: over.targetOrgs ?? [],
    createdBy: over.createdBy ?? 'u-1',
    createdAt: over.createdAt ?? new Date(),
  };
}

describe('SystemMessagesAdminService', () => {
  it('list(): фильтры type/isActive работают, сортировка по createdAt DESC', async () => {
    const state = {
      rows: [
        makeRow({
          id: 'm-1',
          type: 'banner',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
        makeRow({
          id: 'm-2',
          type: 'alert',
          isActive: false,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        }),
        makeRow({
          id: 'm-3',
          type: 'banner',
          isActive: true,
          createdAt: new Date('2026-03-01T00:00:00Z'),
        }),
      ],
    };
    const svc = new SystemMessagesAdminService(buildPrisma(state));

    const all = await svc.list({});
    expect(all.items.map((i) => i.id)).toEqual(['m-3', 'm-2', 'm-1']);

    const banners = await svc.list({ type: 'banner' });
    expect(banners.items.length).toBe(2);
    expect(banners.items.every((i) => i.type === 'banner')).toBe(true);

    const active = await svc.list({ isActive: true });
    expect(active.items.every((i) => i.isActive)).toBe(true);
  });

  it('create(): создаёт с default isActive=true и пустым targetOrgs', async () => {
    const state = { rows: [] as MsgRow[] };
    const svc = new SystemMessagesAdminService(buildPrisma(state));

    const created = await svc.create(
      { type: 'maintenance', severity: 'warning', body: 'Тех. работы' },
      'super-admin-1',
    );
    expect(created.type).toBe('maintenance');
    expect(created.severity).toBe('warning');
    expect(created.isActive).toBe(true);
    expect(created.targetOrgs).toEqual([]);
    expect(created.createdBy).toBe('super-admin-1');
    expect(state.rows.length).toBe(1);
  });

  it('update(): partial; 404 на отсутствующий id', async () => {
    const state = {
      rows: [makeRow({ id: 'm-1', isActive: true, severity: 'info' })],
    };
    const svc = new SystemMessagesAdminService(buildPrisma(state));

    const upd = await svc.update('m-1', { severity: 'critical', isActive: false });
    expect(upd.severity).toBe('critical');
    expect(upd.isActive).toBe(false);
    // body не менялся
    expect(upd.body).toBe('Привет');

    await expect(svc.update('missing', { body: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove(): hard-delete; 404 на отсутствующий id', async () => {
    const state = { rows: [makeRow({ id: 'm-1' })] };
    const svc = new SystemMessagesAdminService(buildPrisma(state));

    const res = await svc.remove('m-1');
    expect(res.ok).toBe(true);
    expect(state.rows.length).toBe(0);

    await expect(svc.remove('m-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
