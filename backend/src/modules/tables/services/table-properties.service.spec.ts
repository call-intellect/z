import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TablePropertiesService } from './table-properties.service';

describe('TablePropertiesService', () => {
  const TENANT = 'org-1';

  let prisma: PrismaService;
  let cfg: TypedConfigService;
  let svc: TablePropertiesService;

  let tableFindUnique: ReturnType<typeof vi.fn>;
  let propFindMany: ReturnType<typeof vi.fn>;
  let propFindFirst: ReturnType<typeof vi.fn>;
  let propFindUnique: ReturnType<typeof vi.fn>;
  let propCount: ReturnType<typeof vi.fn>;
  let propCreate: ReturnType<typeof vi.fn>;
  let propUpdate: ReturnType<typeof vi.fn>;
  let propDelete: ReturnType<typeof vi.fn>;

  function prop(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'p-1',
      tableId: 't-1',
      name: 'Имя',
      type: 'text' as const,
      config: {},
      isPrimary: false,
      order: new Prisma.Decimal(1),
      createdAt: new Date('2026-05-31T10:00:00Z'),
      updatedAt: new Date('2026-05-31T10:00:00Z'),
      ...over,
    };
  }

  beforeEach(() => {
    tableFindUnique = vi.fn();
    propFindMany = vi.fn();
    propFindFirst = vi.fn();
    propFindUnique = vi.fn();
    propCount = vi.fn();
    propCreate = vi.fn();
    propUpdate = vi.fn();
    propDelete = vi.fn();

    prisma = {
      table: { findUnique: tableFindUnique },
      tableProperty: {
        findMany: propFindMany,
        findFirst: propFindFirst,
        findUnique: propFindUnique,
        count: propCount,
        create: propCreate,
        update: propUpdate,
        delete: propDelete,
      },
    } as unknown as PrismaService;

    cfg = {
      smartTables: {
        maxTablesPerOrg: 5,
        maxPropsPerTable: 3,
        maxRowsPerTable: 100,
        maxCellSizeBytes: 1024,
      },
    } as unknown as TypedConfigService;

    svc = new TablePropertiesService(prisma, cfg);
  });

  it('list — проверка scope таблицы + orderBy order asc', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    propFindMany.mockResolvedValueOnce([prop()]);

    const out = await svc.list({ tenantId: TENANT, tableId: 't-1' });
    expect(out).toHaveLength(1);
    const call = propFindMany.mock.calls[0]![0] as {
      where: { tableId: string };
      orderBy: { order: string };
    };
    expect(call.where.tableId).toBe('t-1');
    expect(call.orderBy.order).toBe('asc');
  });

  it('create — лимит превышен → BadRequestException', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    propCount.mockResolvedValueOnce(3);

    await expect(
      svc.create({
        tenantId: TENANT,
        tableId: 't-1',
        input: { name: 'X', type: 'text', config: {}, isPrimary: false },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(propCreate).not.toHaveBeenCalled();
  });

  it('create — order не задан → maxOrder+1', async () => {
    tableFindUnique.mockResolvedValueOnce({ tenantId: TENANT, deletedAt: null });
    propCount.mockResolvedValueOnce(2);
    propFindFirst.mockResolvedValueOnce({ order: new Prisma.Decimal(5) });
    propCreate.mockResolvedValueOnce(prop({ order: new Prisma.Decimal(6) }));

    const out = await svc.create({
      tenantId: TENANT,
      tableId: 't-1',
      input: { name: 'X', type: 'text', config: {}, isPrimary: false },
    });
    expect(out.id).toBe('p-1');
    const created = propCreate.mock.calls[0]![0] as {
      data: { order: Prisma.Decimal };
    };
    expect(Number(created.data.order.toString())).toBe(6);
  });

  it('update — несуществующая колонка → NotFoundException', async () => {
    propFindUnique.mockResolvedValueOnce(null);
    await expect(
      svc.update({
        tenantId: TENANT,
        propertyId: 'missing',
        input: { name: 'new' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete — успех', async () => {
    propFindUnique.mockResolvedValueOnce({
      ...prop(),
      table: { tenantId: TENANT, deletedAt: null },
    });
    propDelete.mockResolvedValueOnce(undefined);
    const out = await svc.delete({ tenantId: TENANT, propertyId: 'p-1' });
    expect(out.id).toBe('p-1');
    expect(propDelete).toHaveBeenCalledTimes(1);
  });
});
