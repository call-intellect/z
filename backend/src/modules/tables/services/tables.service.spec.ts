import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TablesService } from './tables.service';

/**
 * Unit-тесты `TablesService`. БД мокается напрямую (как activity-feed.service.spec).
 *
 * Покрытие:
 *  1. create — ниже лимита: создаёт запись.
 *  2. create — выше лимита: BadRequestException.
 *  3. create с parentDocumentId из другой Org — NotFoundException.
 *  4. findById — не найдена → NotFoundException.
 *  5. findById — чужая Org → NotFoundException (а не 403, чтобы не утечь id).
 *  6. archive → unarchive — переходы и идемпотентность.
 *  7. hardDelete активной таблицы — 403 (нужно сначала архив).
 *  8. hardDelete архивной — успех + caскад через Prisma.
 */
describe('TablesService', () => {
  const TENANT = 'org-1';
  const USER = 'user-1';

  let prisma: PrismaService;
  let cfg: TypedConfigService;
  let svc: TablesService;

  let tableCreate: ReturnType<typeof vi.fn>;
  let tableCount: ReturnType<typeof vi.fn>;
  let tableFindUnique: ReturnType<typeof vi.fn>;
  let tableFindMany: ReturnType<typeof vi.fn>;
  let tableUpdate: ReturnType<typeof vi.fn>;
  let tableDelete: ReturnType<typeof vi.fn>;
  let documentFindUnique: ReturnType<typeof vi.fn>;

  function row(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 't-1',
      tenantId: TENANT,
      name: 'Клиенты',
      description: null,
      icon: null,
      coverImageS3: null,
      parentDocumentId: null,
      entitySync: null,
      defaultViewId: null,
      archivedAt: null,
      createdBy: USER,
      createdAt: new Date('2026-05-31T10:00:00Z'),
      updatedAt: new Date('2026-05-31T10:00:00Z'),
      deletedAt: null,
      ...over,
    };
  }

  beforeEach(() => {
    tableCreate = vi.fn();
    tableCount = vi.fn();
    tableFindUnique = vi.fn();
    tableFindMany = vi.fn();
    tableUpdate = vi.fn();
    tableDelete = vi.fn();
    documentFindUnique = vi.fn();

    prisma = {
      table: {
        create: tableCreate,
        count: tableCount,
        findUnique: tableFindUnique,
        findMany: tableFindMany,
        update: tableUpdate,
        delete: tableDelete,
      },
      document: {
        findUnique: documentFindUnique,
      },
    } as unknown as PrismaService;

    cfg = {
      smartTables: {
        maxTablesPerOrg: 5,
        maxPropsPerTable: 10,
        maxRowsPerTable: 100,
        maxCellSizeBytes: 1024,
      },
    } as unknown as TypedConfigService;

    svc = new TablesService(prisma, cfg);
  });

  it('create — ниже лимита: создаёт таблицу', async () => {
    tableCount.mockResolvedValueOnce(2);
    tableCreate.mockResolvedValueOnce(row());

    const out = await svc.create({
      tenantId: TENANT,
      userId: USER,
      input: { name: 'Клиенты' },
    });

    expect(out.id).toBe('t-1');
    expect(tableCreate).toHaveBeenCalledTimes(1);
    const call = tableCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.tenantId).toBe(TENANT);
    expect(call.data.createdBy).toBe(USER);
    expect(call.data.name).toBe('Клиенты');
  });

  it('create — выше лимита: BadRequestException', async () => {
    tableCount.mockResolvedValueOnce(5);

    await expect(
      svc.create({ tenantId: TENANT, userId: USER, input: { name: 'X' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tableCreate).not.toHaveBeenCalled();
  });

  it('create с parentDocumentId из другой Org → NotFoundException', async () => {
    tableCount.mockResolvedValueOnce(0);
    documentFindUnique.mockResolvedValueOnce({
      tenantId: 'other-org',
      deletedAt: null,
    });

    await expect(
      svc.create({
        tenantId: TENANT,
        userId: USER,
        input: { name: 'X', parentDocumentId: 'doc-1' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findById — не найдена → NotFoundException', async () => {
    tableFindUnique.mockResolvedValueOnce(null);
    await expect(
      svc.findById({ tenantId: TENANT, id: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findById — чужая Org → NotFoundException', async () => {
    tableFindUnique.mockResolvedValueOnce(row({ tenantId: 'other-org' }));
    await expect(
      svc.findById({ tenantId: TENANT, id: 't-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archive → unarchive — переходы и идемпотентность', async () => {
    // 1) первый archive — был null, ставим now()
    tableFindUnique.mockResolvedValueOnce(row({ archivedAt: null }));
    tableUpdate.mockResolvedValueOnce(row({ archivedAt: new Date() }));
    const archived = await svc.archive({ tenantId: TENANT, id: 't-1' });
    expect(archived.archivedAt).not.toBeNull();
    expect(tableUpdate).toHaveBeenCalledTimes(1);

    // 2) повторный archive — уже архивная, no-op (update не зовётся)
    tableUpdate.mockClear();
    tableFindUnique.mockResolvedValueOnce(row({ archivedAt: new Date() }));
    const archived2 = await svc.archive({ tenantId: TENANT, id: 't-1' });
    expect(archived2.archivedAt).not.toBeNull();
    expect(tableUpdate).not.toHaveBeenCalled();

    // 3) unarchive — переход в null
    tableUpdate.mockClear();
    tableFindUnique.mockResolvedValueOnce(row({ archivedAt: new Date() }));
    tableUpdate.mockResolvedValueOnce(row({ archivedAt: null }));
    const restored = await svc.unarchive({ tenantId: TENANT, id: 't-1' });
    expect(restored.archivedAt).toBeNull();
    expect(tableUpdate).toHaveBeenCalledTimes(1);
  });

  it('hardDelete активной таблицы — ForbiddenException', async () => {
    tableFindUnique.mockResolvedValueOnce(row({ archivedAt: null }));
    await expect(
      svc.hardDelete({ tenantId: TENANT, id: 't-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tableDelete).not.toHaveBeenCalled();
  });

  it('hardDelete архивной — успех', async () => {
    tableFindUnique.mockResolvedValueOnce(row({ archivedAt: new Date() }));
    tableDelete.mockResolvedValueOnce(undefined);
    const out = await svc.hardDelete({ tenantId: TENANT, id: 't-1' });
    expect(out.id).toBe('t-1');
    expect(tableDelete).toHaveBeenCalledTimes(1);
  });
});
