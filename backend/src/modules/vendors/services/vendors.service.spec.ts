/**
 * Sprints (2026-05-28) §1.1 — юнит-тесты VendorsService.create/update/softDelete.
 *
 * Покрытие:
 *   - create: успех (создание Entity + Vendor в транзакции) + tenantId isolation;
 *   - create: переиспользование существующего Entity при P2002 collision;
 *   - update: только разрешённые поля; 404 на чужой/удалённый vendor;
 *   - softDelete: проставляет deletedAt; идемпотентен; 404 на чужой.
 */
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { VendorsService } from './vendors.service';

interface VendorRow {
  id: string;
  tenantId: string;
  entityId: string;
  name: string;
  inn: string | null;
  segment: string | null;
  status: string;
  responsibleUserId: string | null;
  contractIds: string[];
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function buildVendorRow(overrides: Partial<VendorRow> = {}): VendorRow {
  const now = new Date('2026-05-28T00:00:00Z');
  return {
    id: 'v-1',
    tenantId: 'org-1',
    entityId: 'e-1',
    name: 'Поставщик А',
    inn: null,
    segment: null,
    status: 'active',
    responsibleUserId: null,
    contractIds: [],
    metadata: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe('VendorsService.create', () => {
  it('создаёт Entity + Vendor в транзакции, возвращает VendorDto', async () => {
    const entityCreate = vi.fn(async () => ({ id: 'e-1' }));
    const vendorFindUnique = vi.fn(async () => null);
    const vendorCreate = vi.fn(async () =>
      buildVendorRow({ name: 'ООО Альфа', entityId: 'e-1' }),
    );
    const prisma = {
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          entity: { create: entityCreate, findFirst: vi.fn() },
          vendor: { findUnique: vendorFindUnique, create: vendorCreate },
        }),
    };
    const svc = new VendorsService(prisma as never);
    const res = await svc.create({
      tenantId: 'org-1',
      actorUserId: 'u-1',
      dto: { name: 'ООО Альфа', status: 'active' },
    });
    expect(res.name).toBe('ООО Альфа');
    expect(res.entityId).toBe('e-1');
    expect(res.status).toBe('active');
    expect(entityCreate).toHaveBeenCalledTimes(1);
    expect(entityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'org-1',
          type: 'vendor',
          name: 'ООО Альфа',
          canonicalName: 'ооо альфа',
        }),
      }),
    );
    expect(vendorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'org-1',
          entityId: 'e-1',
          status: 'active',
        }),
      }),
    );
  });

  it('при P2002 на Entity переиспользует существующий и создаёт только Vendor', async () => {
    const p2002 = Object.assign(new Error('Unique violation'), { code: 'P2002' });
    const entityCreate = vi.fn(async () => {
      throw p2002;
    });
    const entityFindFirst = vi.fn(async () => ({ id: 'e-existing' }));
    const vendorFindUnique = vi.fn(async () => null);
    const vendorCreate = vi.fn(async () =>
      buildVendorRow({ entityId: 'e-existing', id: 'v-new' }),
    );
    const prisma = {
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          entity: { create: entityCreate, findFirst: entityFindFirst },
          vendor: { findUnique: vendorFindUnique, create: vendorCreate },
        }),
    };
    const svc = new VendorsService(prisma as never);
    const res = await svc.create({
      tenantId: 'org-1',
      actorUserId: 'u-1',
      dto: { name: 'Поставщик А', status: 'active' },
    });
    expect(res.id).toBe('v-new');
    expect(res.entityId).toBe('e-existing');
    expect(entityFindFirst).toHaveBeenCalled();
    expect(vendorCreate).toHaveBeenCalled();
  });

  it('если на существующем Entity уже есть Vendor — возвращает его', async () => {
    const p2002 = Object.assign(new Error('Unique violation'), { code: 'P2002' });
    const entityCreate = vi.fn(async () => {
      throw p2002;
    });
    const entityFindFirst = vi.fn(async () => ({ id: 'e-existing' }));
    const existingVendor = buildVendorRow({
      id: 'v-existing',
      entityId: 'e-existing',
    });
    const vendorFindUnique = vi
      .fn()
      // первый вызов — проверка существования (idempotency)
      .mockResolvedValueOnce({ id: 'v-existing' })
      // второй вызов — дотягиваем полную запись
      .mockResolvedValueOnce(existingVendor);
    const vendorCreate = vi.fn();
    const prisma = {
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          entity: { create: entityCreate, findFirst: entityFindFirst },
          vendor: { findUnique: vendorFindUnique, create: vendorCreate },
        }),
    };
    const svc = new VendorsService(prisma as never);
    const res = await svc.create({
      tenantId: 'org-1',
      actorUserId: 'u-1',
      dto: { name: 'Поставщик А', status: 'active' },
    });
    expect(res.id).toBe('v-existing');
    expect(vendorCreate).not.toHaveBeenCalled();
  });

  it('передаёт inn / segment / responsibleUserId в БД', async () => {
    const entityCreate = vi.fn(async () => ({ id: 'e-1' }));
    const vendorFindUnique = vi.fn(async () => null);
    const vendorCreate = vi.fn(async () =>
      buildVendorRow({
        inn: '7700000001',
        segment: 'software',
        responsibleUserId: 'u-2',
      }),
    );
    const prisma = {
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          entity: { create: entityCreate, findFirst: vi.fn() },
          vendor: { findUnique: vendorFindUnique, create: vendorCreate },
        }),
    };
    const svc = new VendorsService(prisma as never);
    const res = await svc.create({
      tenantId: 'org-1',
      actorUserId: 'u-1',
      dto: {
        name: 'Поставщик А',
        inn: '7700000001',
        segment: 'software',
        status: 'active',
        responsibleUserId: 'u-2',
      },
    });
    expect(res.inn).toBe('7700000001');
    expect(res.segment).toBe('software');
    expect(res.responsibleUserId).toBe('u-2');
    expect(vendorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inn: '7700000001',
          segment: 'software',
          responsibleUserId: 'u-2',
        }),
      }),
    );
  });
});

describe('VendorsService.update', () => {
  it('частичное обновление имени и статуса', async () => {
    const existing = buildVendorRow();
    const updated = buildVendorRow({
      name: 'Поставщик Б',
      status: 'evaluating',
    });
    const findUnique = vi.fn(async () => existing);
    const update = vi.fn(async () => updated);
    const prisma = { vendor: { findUnique, update } };
    const svc = new VendorsService(prisma as never);
    const res = await svc.update({
      tenantId: 'org-1',
      id: 'v-1',
      actorUserId: 'u-1',
      dto: { name: 'Поставщик Б', status: 'evaluating' },
    });
    expect(res.name).toBe('Поставщик Б');
    expect(res.status).toBe('evaluating');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v-1' },
        data: expect.objectContaining({
          name: 'Поставщик Б',
          status: 'evaluating',
        }),
      }),
    );
  });

  it('404 если vendor в другом tenant', async () => {
    const findUnique = vi.fn(async () =>
      buildVendorRow({ tenantId: 'other-org' }),
    );
    const prisma = { vendor: { findUnique, update: vi.fn() } };
    const svc = new VendorsService(prisma as never);
    await expect(
      svc.update({
        tenantId: 'org-1',
        id: 'v-1',
        actorUserId: 'u-1',
        dto: { name: 'X' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 если vendor soft-deleted', async () => {
    const findUnique = vi.fn(async () =>
      buildVendorRow({ deletedAt: new Date() }),
    );
    const prisma = { vendor: { findUnique, update: vi.fn() } };
    const svc = new VendorsService(prisma as never);
    await expect(
      svc.update({
        tenantId: 'org-1',
        id: 'v-1',
        actorUserId: 'u-1',
        dto: { name: 'X' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('пустой dto — no-op, но 200 OK с актуальной записью', async () => {
    const existing = buildVendorRow();
    const findUnique = vi.fn(async () => existing);
    const update = vi.fn(async () => existing);
    const prisma = { vendor: { findUnique, update } };
    const svc = new VendorsService(prisma as never);
    const res = await svc.update({
      tenantId: 'org-1',
      id: 'v-1',
      actorUserId: 'u-1',
      dto: {},
    });
    expect(res.id).toBe('v-1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {},
      }),
    );
  });
});

describe('VendorsService.softDelete', () => {
  it('проставляет deletedAt + возвращает ok', async () => {
    const findUnique = vi.fn(async () => ({
      id: 'v-1',
      tenantId: 'org-1',
      deletedAt: null,
    }));
    const update = vi.fn(async () => ({ id: 'v-1', deletedAt: new Date() }));
    const prisma = { vendor: { findUnique, update } };
    const svc = new VendorsService(prisma as never);
    const res = await svc.softDelete({
      tenantId: 'org-1',
      id: 'v-1',
      actorUserId: 'u-1',
    });
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v-1' },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it('идемпотентен: повторный вызов на уже удалённом возвращает ok', async () => {
    const findUnique = vi.fn(async () => ({
      id: 'v-1',
      tenantId: 'org-1',
      deletedAt: new Date(),
    }));
    const update = vi.fn();
    const prisma = { vendor: { findUnique, update } };
    const svc = new VendorsService(prisma as never);
    const res = await svc.softDelete({
      tenantId: 'org-1',
      id: 'v-1',
      actorUserId: 'u-1',
    });
    expect(res).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
  });

  it('404 на vendor чужого tenant', async () => {
    const findUnique = vi.fn(async () => ({
      id: 'v-1',
      tenantId: 'other-org',
      deletedAt: null,
    }));
    const prisma = { vendor: { findUnique, update: vi.fn() } };
    const svc = new VendorsService(prisma as never);
    await expect(
      svc.softDelete({
        tenantId: 'org-1',
        id: 'v-1',
        actorUserId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
