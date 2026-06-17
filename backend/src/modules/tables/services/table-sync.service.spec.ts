import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TableSyncService } from './table-sync.service';

describe('TableSyncService', () => {
  const TENANT = 'org-1';

  const PROPS = [
    {
      id: 'p-name',
      name: 'Название',
      config: { readonly: true, source: 'entity', entityAttribute: 'canonicalName' },
    },
    {
      id: 'p-email',
      name: 'Email',
      config: { readonly: true, source: 'entity', entityAttribute: 'email' },
    },
    {
      id: 'p-phone',
      name: 'Телефон',
      config: { readonly: true, source: 'entity', entityAttribute: 'phone' },
    },
    { id: 'p-stage', name: 'Стадия', config: {} },
  ];

  const TABLE = {
    id: 't-1',
    tenantId: TENANT,
    deletedAt: null,
    archivedAt: null,
    entitySync: { type: 'org', autoCreate: true, entityTypes: ['customer'] },
    properties: PROPS,
  };

  function entity(over: Record<string, unknown> = {}) {
    return {
      id: 'ent-1',
      tenantId: TENANT,
      type: 'customer',
      canonicalName: 'ООО Ромашка',
      email: 'sales@romashka.ru',
      phone: '+79991234567',
      domain: null,
      inn: null,
      ogrn: null,
      mergedIntoId: null,
      metadata: null,
      ...over,
    };
  }

  let prisma: PrismaService;
  let svc: TableSyncService;

  let tableFindMany: ReturnType<typeof vi.fn>;
  let tableFindUnique: ReturnType<typeof vi.fn>;
  let entityFindUnique: ReturnType<typeof vi.fn>;
  let entityFindMany: ReturnType<typeof vi.fn>;
  let rowFindFirst: ReturnType<typeof vi.fn>;
  let rowFindMany: ReturnType<typeof vi.fn>;
  let rowCreate: ReturnType<typeof vi.fn>;
  let rowCreateMany: ReturnType<typeof vi.fn>;
  let rowUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tableFindMany = vi.fn();
    tableFindUnique = vi.fn();
    entityFindUnique = vi.fn();
    entityFindMany = vi.fn();
    rowFindFirst = vi.fn();
    rowFindMany = vi.fn();
    rowCreate = vi.fn();
    rowCreateMany = vi.fn();
    rowUpdate = vi.fn();

    prisma = {
      table: { findMany: tableFindMany, findUnique: tableFindUnique },
      entity: { findUnique: entityFindUnique, findMany: entityFindMany },
      tableRow: {
        findFirst: rowFindFirst,
        findMany: rowFindMany,
        create: rowCreate,
        createMany: rowCreateMany,
        update: rowUpdate,
      },
    } as unknown as PrismaService;

    svc = new TableSyncService(prisma);
  });

  it('(a) entity.created (customer) → создаётся строка, canonicalName → ячейка name', async () => {
    tableFindMany.mockResolvedValueOnce([TABLE]);
    entityFindUnique.mockResolvedValueOnce(entity());
    rowFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    rowFindMany.mockResolvedValueOnce([]);
    rowCreate.mockResolvedValueOnce({ id: 'r-1' });

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'created',
    });

    expect(rowCreate).toHaveBeenCalledTimes(1);
    const data = rowCreate.mock.calls[0]![0].data as {
      cells: Record<string, unknown>;
      entityId: string;
    };
    expect(data.entityId).toBe('ent-1');
    expect(data.cells['p-name']).toBe('ООО Ромашка');
    expect(data.cells['p-email']).toBe('sales@romashka.ru');
    expect(data.cells['p-phone']).toBe('+79991234567');
    expect(data.cells['p-stage']).toBeUndefined();
  });

  it('(b) entity.updated → перетираются только entity-ячейки, ручная не тронута', async () => {
    tableFindMany.mockResolvedValueOnce([TABLE]);
    entityFindUnique.mockResolvedValueOnce(entity({ canonicalName: 'ООО Ромашка (ребренд)' }));
    rowFindFirst.mockResolvedValueOnce({
      id: 'r-1',
      cells: { 'p-name': 'ООО Ромашка', 'p-stage': 'opt-3', 'p-email': 'old@x.ru' },
    });
    rowUpdate.mockResolvedValueOnce({ id: 'r-1' });

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'updated',
    });

    expect(rowCreate).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalledTimes(1);
    const data = rowUpdate.mock.calls[0]![0].data as {
      cells: Record<string, unknown>;
    };
    expect(data.cells['p-name']).toBe('ООО Ромашка (ребренд)');
    expect(data.cells['p-email']).toBe('sales@romashka.ru');
    expect(data.cells['p-stage']).toBe('opt-3');
  });

  it('(c) entity.archived → строка получает archivedAt, не удаляется', async () => {
    tableFindMany.mockResolvedValueOnce([TABLE]);
    rowFindFirst.mockResolvedValueOnce({ id: 'r-1' });
    rowUpdate.mockResolvedValueOnce({ id: 'r-1' });

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'archived',
    });

    expect(entityFindUnique).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalledTimes(1);
    const data = rowUpdate.mock.calls[0]![0].data as { archivedAt: Date };
    expect(data.archivedAt).toBeInstanceOf(Date);
  });

  it('(d) идемпотентность: повторный created для того же entityId не создаёт дубль', async () => {
    tableFindMany.mockResolvedValueOnce([TABLE]);
    entityFindUnique.mockResolvedValueOnce(entity());
    rowFindFirst.mockResolvedValueOnce({
      id: 'r-1',
      cells: { 'p-name': 'ООО Ромашка' },
    });
    rowUpdate.mockResolvedValueOnce({ id: 'r-1' });

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'created',
    });

    expect(rowCreate).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalledTimes(1);
  });

  it('(e) конфликт-резолвер: ручная строка с совпадающим email сливается (entityId)', async () => {
    tableFindMany.mockResolvedValueOnce([TABLE]);
    entityFindUnique.mockResolvedValueOnce(entity());
    rowFindFirst.mockResolvedValueOnce(null);
    rowFindMany.mockResolvedValueOnce([
      {
        id: 'manual-1',
        cells: { 'p-name': 'Ромашка', 'p-email': 'sales@romashka.ru', 'p-stage': 'opt-2' },
      },
    ]);
    rowUpdate.mockResolvedValueOnce({ id: 'manual-1' });

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'created',
    });

    expect(rowCreate).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalledTimes(1);
    const call = rowUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: { entityId: string; cells: Record<string, unknown> };
    };
    expect(call.where.id).toBe('manual-1');
    expect(call.data.entityId).toBe('ent-1');
    expect(call.data.cells['p-name']).toBe('ООО Ромашка');
    expect(call.data.cells['p-stage']).toBe('opt-2');
  });

  it('таблица без autoCreate / другого класса Entity → no-op', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        ...TABLE,
        entitySync: { type: 'org', autoCreate: true, entityTypes: ['vendor'] },
      },
    ]);

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'created',
    });

    expect(entityFindUnique).not.toHaveBeenCalled();
    expect(rowCreate).not.toHaveBeenCalled();
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it('order создаётся как Decimal', async () => {
    tableFindMany.mockResolvedValueOnce([TABLE]);
    entityFindUnique.mockResolvedValueOnce(entity());
    rowFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      order: new Prisma.Decimal(5),
    });
    rowFindMany.mockResolvedValueOnce([]);
    rowCreate.mockResolvedValueOnce({ id: 'r-2' });

    await svc.applyEntityEvent({
      tenantId: TENANT,
      entityId: 'ent-1',
      entityType: 'customer',
      eventType: 'created',
    });

    const data = rowCreate.mock.calls[0]![0].data as { order: Prisma.Decimal };
    expect(data.order).toBeInstanceOf(Prisma.Decimal);
    expect(Number(data.order.toString())).toBe(6);
  });
});
