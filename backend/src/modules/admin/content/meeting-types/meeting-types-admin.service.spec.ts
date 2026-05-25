/**
 * Admin-redesign Фаза 5 — unit-тесты `MeetingTypesAdminService`.
 *
 * Покрываем:
 *   1) list(): на пустой БД делает bootstrap-sync и возвращает enum-значения.
 *   2) create(): создаёт MeetingTypeConfig; 400 если id занят.
 *   3) update(): partial-обновление обновляет только переданные поля.
 *   4) softDelete(): isActive=false; 404 для отсутствующего id.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { MeetingTypesAdminService } from './meeting-types-admin.service';

interface ConfigRow {
  id: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  reportPromptKey: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: Date;
}

function buildPrisma(state: { rows: ConfigRow[] }): PrismaService {
  const count = vi.fn(async () => state.rows.length);
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    return state.rows.find((r) => r.id === where.id) ?? null;
  });
  const findMany = vi.fn(async () => {
    return [...state.rows].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );
  });
  const create = vi.fn(async ({ data }: { data: Partial<ConfigRow> & { id: string } }) => {
    const row: ConfigRow = {
      id: data.id,
      displayName: data.displayName ?? data.id,
      description: data.description ?? null,
      icon: data.icon ?? null,
      reportPromptKey: data.reportPromptKey ?? null,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      updatedBy: data.updatedBy ?? null,
      updatedAt: new Date(),
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
      data: Partial<ConfigRow>;
    }) => {
      const r = state.rows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
  );
  const upsert = vi.fn(
    async ({
      where,
      create: createData,
    }: {
      where: { id: string };
      create: Partial<ConfigRow> & { id: string };
      update: Partial<ConfigRow>;
    }) => {
      let r = state.rows.find((x) => x.id === where.id);
      if (!r) {
        r = {
          id: createData.id,
          displayName: createData.displayName ?? createData.id,
          description: createData.description ?? null,
          icon: createData.icon ?? null,
          reportPromptKey: createData.reportPromptKey ?? null,
          isActive: createData.isActive ?? true,
          sortOrder: createData.sortOrder ?? 0,
          updatedBy: createData.updatedBy ?? null,
          updatedAt: new Date(),
        };
        state.rows.push(r);
      }
      return r;
    },
  );

  return {
    meetingTypeConfig: { count, findUnique, findMany, create, update, upsert },
  } as unknown as PrismaService;
}

describe('MeetingTypesAdminService', () => {
  it('list(): на пустой БД делает bootstrap-sync и возвращает enum-значения', async () => {
    const state = { rows: [] as ConfigRow[] };
    const svc = new MeetingTypesAdminService(buildPrisma(state));
    const res = await svc.list();
    // Enum MeetingType содержит как минимум 9 значений MVP.
    expect(res.items.length).toBeGreaterThanOrEqual(9);
    expect(state.rows.length).toBeGreaterThanOrEqual(9);
    // sortOrder проставлен (default 0 если не задан — но в bootstrap проставляем).
    expect(res.items.every((i) => typeof i.sortOrder === 'number')).toBe(true);
    // Все элементы изначально активны.
    expect(res.items.every((i) => i.isActive === true)).toBe(true);
  });

  it('create(): создаёт MeetingTypeConfig; 400 если id занят', async () => {
    const state = {
      rows: [makeRow({ id: 'standup' })],
    };
    const svc = new MeetingTypesAdminService(buildPrisma(state));

    await expect(
      svc.create({ id: 'standup', displayName: 'Dup' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const created = await svc.create(
      {
        id: 'team',
        displayName: 'Командная',
        description: 'Регулярная синхронизация',
        sortOrder: 1,
      },
      'user-1',
    );
    expect(created.id).toBe('team');
    expect(created.displayName).toBe('Командная');
    expect(created.updatedBy).toBe('user-1');
    expect(state.rows.length).toBe(2);
  });

  it('update(): partial-обновление обновляет только переданные поля', async () => {
    const state = {
      rows: [
        makeRow({
          id: 'sales',
          displayName: 'Продажи',
          description: 'Старое описание',
          sortOrder: 5,
        }),
      ],
    };
    const svc = new MeetingTypesAdminService(buildPrisma(state));

    const upd = await svc.update(
      'sales',
      { displayName: 'Продажи (новое)', isActive: false },
      'user-2',
    );
    expect(upd.displayName).toBe('Продажи (новое)');
    expect(upd.isActive).toBe(false);
    // description не менялся.
    expect(upd.description).toBe('Старое описание');
    expect(upd.sortOrder).toBe(5);
    expect(upd.updatedBy).toBe('user-2');
  });

  it('softDelete(): isActive=false; 404 для отсутствующего id', async () => {
    const state = {
      rows: [makeRow({ id: 'review', isActive: true })],
    };
    const svc = new MeetingTypesAdminService(buildPrisma(state));

    await expect(svc.softDelete('missing', null)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const res = await svc.softDelete('review', 'user-3');
    expect(res.ok).toBe(true);
    expect(state.rows[0]?.isActive).toBe(false);
    expect(state.rows[0]?.updatedBy).toBe('user-3');
  });
});

function makeRow(over: Partial<ConfigRow>): ConfigRow {
  return {
    id: over.id ?? 'standup',
    displayName: over.displayName ?? over.id ?? 'standup',
    description: over.description ?? null,
    icon: over.icon ?? null,
    reportPromptKey: over.reportPromptKey ?? null,
    isActive: over.isActive ?? true,
    sortOrder: over.sortOrder ?? 0,
    updatedBy: over.updatedBy ?? null,
    updatedAt: over.updatedAt ?? new Date(),
  };
}
