import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RbacService } from '../../rbac/rbac.service';

import { TableViewsService } from './table-views.service';

/**
 * Unit-тесты `TableViewsService` — Saved Views (Фаза 3).
 *
 * Покрытие:
 *  1. create — view создаётся с ownerId=userId.
 *  2. list   — пользователь видит свои personal + shared/public.
 *  3. list   — чужие personal-виды скрываются (фильтр в where).
 *  4. update — владелец может править свой view.
 *  5. update — чужой view, не admin → ForbiddenException.
 */
describe('TableViewsService', () => {
  const TENANT = 'org-1';
  const USER = 'user-1';
  const OTHER = 'user-other';
  const TABLE_ID = 't-1';

  let prisma: PrismaService;
  let rbac: RbacService;
  let svc: TableViewsService;

  let tableFindUnique: ReturnType<typeof vi.fn>;
  let viewFindMany: ReturnType<typeof vi.fn>;
  let viewFindUnique: ReturnType<typeof vi.fn>;
  let viewCreate: ReturnType<typeof vi.fn>;
  let viewUpdate: ReturnType<typeof vi.fn>;
  let viewDelete: ReturnType<typeof vi.fn>;
  let canWrite: ReturnType<typeof vi.fn>;

  function view(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'v-1',
      tableId: TABLE_ID,
      name: 'Без названия',
      type: 'grid' as const,
      config: {},
      visibility: 'personal' as const,
      ownerId: USER,
      createdAt: new Date('2026-05-31T10:00:00Z'),
      updatedAt: new Date('2026-05-31T10:00:00Z'),
      ...over,
    };
  }

  beforeEach(() => {
    tableFindUnique = vi.fn();
    viewFindMany = vi.fn();
    viewFindUnique = vi.fn();
    viewCreate = vi.fn();
    viewUpdate = vi.fn();
    viewDelete = vi.fn();
    canWrite = vi.fn();

    prisma = {
      table: { findUnique: tableFindUnique },
      tableView: {
        findMany: viewFindMany,
        findUnique: viewFindUnique,
        create: viewCreate,
        update: viewUpdate,
        delete: viewDelete,
      },
    } as unknown as PrismaService;

    rbac = {
      canWrite,
    } as unknown as RbacService;

    svc = new TableViewsService(prisma, rbac);
  });

  it('create — view создаётся с ownerId=userId', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    viewCreate.mockResolvedValueOnce(view({ name: 'Мой срез' }));

    const out = await svc.create({
      tenantId: TENANT,
      tableId: TABLE_ID,
      userId: USER,
      input: {
        name: 'Мой срез',
        type: 'grid',
        config: { hiddenProps: ['p-2'] },
        visibility: 'personal',
      },
    });

    expect(out.id).toBe('v-1');
    expect(viewCreate).toHaveBeenCalledTimes(1);
    const call = viewCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.ownerId).toBe(USER);
    expect(call.data.tableId).toBe(TABLE_ID);
    expect(call.data.visibility).toBe('personal');
  });

  it('list — фильтр включает свои personal + shared/public', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    viewFindMany.mockResolvedValueOnce([
      view({ id: 'v-mine', ownerId: USER, visibility: 'personal' }),
      view({ id: 'v-shared', ownerId: OTHER, visibility: 'shared' }),
    ]);

    const out = await svc.list({
      tenantId: TENANT,
      tableId: TABLE_ID,
      userId: USER,
    });
    expect(out).toHaveLength(2);

    const call = viewFindMany.mock.calls[0]![0] as {
      where: { tableId: string; OR: unknown[] };
    };
    expect(call.where.tableId).toBe(TABLE_ID);
    expect(Array.isArray(call.where.OR)).toBe(true);
    // OR содержит ветку «shared/public» и ветку «personal + ownerId=USER».
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          visibility: expect.objectContaining({ in: ['shared', 'public'] }),
        }),
        expect.objectContaining({ visibility: 'personal', ownerId: USER }),
      ]),
    );
  });

  it('list — чужой personal не попадает (where.OR построен корректно)', async () => {
    // Эквивалентно п.2: проверяем точечно, что в where OR нет ветки,
    // которая бы пропустила personal без ownerId=USER. Дополнительно — emit
    // findMany не должен включать в условие чужие personal.
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    viewFindMany.mockResolvedValueOnce([]);

    await svc.list({ tenantId: TENANT, tableId: TABLE_ID, userId: USER });

    const call = viewFindMany.mock.calls[0]![0] as { where: { OR: unknown[] } };
    // Ни одна ветка не должна разрешать personal без ownerId-фильтра.
    for (const branch of call.where.OR) {
      const b = branch as { visibility?: unknown; ownerId?: unknown };
      if (b.visibility === 'personal') {
        expect(b.ownerId).toBe(USER);
      }
    }
  });

  it('update — владелец правит свой view', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    viewFindUnique.mockResolvedValueOnce(view({ ownerId: USER }));
    viewUpdate.mockResolvedValueOnce(view({ name: 'Новое имя' }));

    const out = await svc.update({
      tenantId: TENANT,
      tableId: TABLE_ID,
      viewId: 'v-1',
      userId: USER,
      input: { name: 'Новое имя' },
    });

    expect(out.id).toBe('v-1');
    expect(viewUpdate).toHaveBeenCalledTimes(1);
    // canWrite не должен звался — владелец и так может.
    expect(canWrite).not.toHaveBeenCalled();
  });

  it('update — чужой view без admin прав → ForbiddenException', async () => {
    // findById должен сработать: visibility=shared, поэтому USER его видит,
    // но редактировать не может — view не его, и canWrite=false.
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    viewFindUnique.mockResolvedValueOnce(
      view({ ownerId: OTHER, visibility: 'shared' }),
    );
    canWrite.mockResolvedValueOnce(false);

    await expect(
      svc.update({
        tenantId: TENANT,
        tableId: TABLE_ID,
        viewId: 'v-1',
        userId: USER,
        input: { name: 'Хочу переименовать чужой' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(canWrite).toHaveBeenCalledTimes(1);
    expect(viewUpdate).not.toHaveBeenCalled();
  });

  it('findById — чужой personal → NotFoundException (а не 403)', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    viewFindUnique.mockResolvedValueOnce(
      view({ ownerId: OTHER, visibility: 'personal' }),
    );

    await expect(
      svc.findById({
        tenantId: TENANT,
        tableId: TABLE_ID,
        viewId: 'v-1',
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
