import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TableRowsService } from './table-rows.service';

/**
 * Unit-тесты `TableRowsService`.
 *
 * Покрытие:
 *  1. create — лимит строк превышен → 400.
 *  2. create — value ячейки больше cap → 400 с конкретным propertyId.
 *  3. create — успешно: order auto, cells/entityId записываются.
 *  4. list — фильтрация archived='active'.
 *  5. hardDelete активной → 403.
 */
describe('TableRowsService', () => {
  const TENANT = 'org-1';
  const USER = 'user-1';

  let prisma: PrismaService;
  let cfg: TypedConfigService;
  let svc: TableRowsService;

  let tableFindUnique: ReturnType<typeof vi.fn>;
  let propertyFindMany: ReturnType<typeof vi.fn>;
  let rowFindMany: ReturnType<typeof vi.fn>;
  let rowFindFirst: ReturnType<typeof vi.fn>;
  let rowFindUnique: ReturnType<typeof vi.fn>;
  let rowCount: ReturnType<typeof vi.fn>;
  let rowCreate: ReturnType<typeof vi.fn>;
  let rowUpdate: ReturnType<typeof vi.fn>;
  let rowDelete: ReturnType<typeof vi.fn>;

  function rowEntity(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'r-1',
      tableId: 't-1',
      tenantId: TENANT,
      cells: {},
      entityId: null,
      order: new Prisma.Decimal(1),
      archivedAt: null,
      createdBy: USER,
      createdAt: new Date('2026-05-31T10:00:00Z'),
      updatedAt: new Date('2026-05-31T10:00:00Z'),
      deletedAt: null,
      pageContent: null,
      ...over,
    };
  }

  beforeEach(() => {
    tableFindUnique = vi.fn();
    propertyFindMany = vi.fn();
    rowFindMany = vi.fn();
    rowFindFirst = vi.fn();
    rowFindUnique = vi.fn();
    rowCount = vi.fn();
    rowCreate = vi.fn();
    rowUpdate = vi.fn();
    rowDelete = vi.fn();

    prisma = {
      table: { findUnique: tableFindUnique },
      tableProperty: { findMany: propertyFindMany },
      tableRow: {
        findMany: rowFindMany,
        findFirst: rowFindFirst,
        findUnique: rowFindUnique,
        count: rowCount,
        create: rowCreate,
        update: rowUpdate,
        delete: rowDelete,
      },
    } as unknown as PrismaService;

    cfg = {
      smartTables: {
        maxTablesPerOrg: 5,
        maxPropsPerTable: 10,
        maxRowsPerTable: 3,
        // Маленький cap, чтобы тест на cell_too_large был детерминированный.
        maxCellSizeBytes: 50,
      },
    } as unknown as TypedConfigService;

    svc = new TableRowsService(prisma, cfg);
  });

  it('create — лимит строк превышен → BadRequestException', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    rowCount.mockResolvedValueOnce(3); // === cap

    await expect(
      svc.create({
        tenantId: TENANT,
        tableId: 't-1',
        userId: USER,
        input: { cells: {} },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rowCreate).not.toHaveBeenCalled();
  });

  it('create — value ячейки больше cap → BadRequestException', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    rowCount.mockResolvedValueOnce(0);

    // 60 байт > 50 байт лимита.
    const longValue = 'x'.repeat(60);
    try {
      await svc.create({
        tenantId: TENANT,
        tableId: 't-1',
        userId: USER,
        input: { cells: { propA: longValue } },
      });
      throw new Error('должно было упасть');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const err = e as BadRequestException;
      const body = err.getResponse() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('cell_too_large');
      expect(body.error.message).toContain('propA');
    }
    expect(rowCreate).not.toHaveBeenCalled();
  });

  it('create — order auto: maxOrder+1', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    rowCount.mockResolvedValueOnce(1);
    rowFindFirst.mockResolvedValueOnce({ order: new Prisma.Decimal(7) });
    rowCreate.mockResolvedValueOnce(rowEntity({ order: new Prisma.Decimal(8) }));

    const out = await svc.create({
      tenantId: TENANT,
      tableId: 't-1',
      userId: USER,
      input: { cells: { propA: 'Иван' }, entityId: 'ent-1' },
    });
    expect(out.id).toBe('r-1');
    const created = rowCreate.mock.calls[0]![0] as {
      data: { order: Prisma.Decimal; entityId: string | null; tenantId: string };
    };
    expect(Number(created.data.order.toString())).toBe(8);
    expect(created.data.entityId).toBe('ent-1');
    expect(created.data.tenantId).toBe(TENANT);
  });

  it('list — фильтрует archived=active', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    rowFindMany.mockResolvedValueOnce([rowEntity()]);
    rowCount.mockResolvedValueOnce(1);

    const out = await svc.list({
      tenantId: TENANT,
      tableId: 't-1',
      query: { archived: 'active', limit: 100, offset: 0 },
    });
    expect(out.items).toHaveLength(1);
    const findCall = rowFindMany.mock.calls[0]![0] as {
      where: { archivedAt: null | { not: null }; tableId: string };
    };
    expect(findCall.where.archivedAt).toBeNull();
    expect(findCall.where.tableId).toBe('t-1');
  });

  it('hardDelete активной → ForbiddenException', async () => {
    rowFindUnique.mockResolvedValueOnce(rowEntity({ archivedAt: null }));
    await expect(
      svc.hardDelete({ tenantId: TENANT, rowId: 'r-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rowDelete).not.toHaveBeenCalled();
  });

  it('findById — чужая Org → NotFoundException', async () => {
    rowFindUnique.mockResolvedValueOnce(rowEntity({ tenantId: 'other-org' }));
    await expect(
      svc.findById({ tenantId: TENANT, rowId: 'r-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update — PATCH read-only entity-ячейки → 422 table_cell_readonly', async () => {
    rowFindUnique.mockResolvedValueOnce(rowEntity());
    // колонка p-name read-only (source='entity')
    propertyFindMany.mockResolvedValueOnce([
      {
        id: 'p-name',
        name: 'Название',
        config: { source: 'entity', entityAttribute: 'canonicalName' },
      },
    ]);

    try {
      await svc.update({
        tenantId: TENANT,
        rowId: 'r-1',
        input: { cells: { 'p-name': 'Хочу переименовать' } },
      });
      throw new Error('должно было упасть');
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      const body = (e as UnprocessableEntityException).getResponse() as {
        error: { code: string };
      };
      expect(body.error.code).toBe('table_cell_readonly');
    }
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it('update — PATCH ручной ячейки → проходит', async () => {
    rowFindUnique.mockResolvedValueOnce(rowEntity());
    // колонка p-stage ручная (config пустой)
    propertyFindMany.mockResolvedValueOnce([
      { id: 'p-stage', name: 'Стадия', config: {} },
    ]);
    rowUpdate.mockResolvedValueOnce(rowEntity({ cells: { 'p-stage': 'opt-2' } }));

    const out = await svc.update({
      tenantId: TENANT,
      rowId: 'r-1',
      input: { cells: { 'p-stage': 'opt-2' } },
    });
    expect(out.id).toBe('r-1');
    expect(rowUpdate).toHaveBeenCalledTimes(1);
  });
});
