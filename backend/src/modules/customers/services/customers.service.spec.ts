import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CustomersService } from './customers.service';
import { ListCustomersQuerySchema } from '../dto/customers.dto';

interface CustomerRow {
  id: string;
  tenantId: string;
  entityId: string;
  name: string;
  inn: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  externalCrmId: string | null;
  responsiblePersonId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function buildCustomerRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  const now = new Date('2026-06-23T00:00:00Z');
  return {
    id: 'c-1',
    tenantId: 'org-1',
    entityId: 'e-1',
    name: 'Клиент А',
    inn: null,
    email: null,
    phone: null,
    status: 'active',
    source: null,
    externalCrmId: null,
    responsiblePersonId: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe('CustomersService.list', () => {
  it('фильтрует deletedAt:null когда includeDeleted=false', async () => {
    const findMany = vi.fn(async () => [buildCustomerRow()]);
    const count = vi.fn(async () => 1);
    const prisma = { customer: { findMany, count } };
    const svc = new CustomersService(prisma as never);
    const query = ListCustomersQuerySchema.parse({});
    const res = await svc.list({ tenantId: 'org-1', query });
    expect(res.total).toBe(1);
    expect(res.items[0]?.id).toBe('c-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'org-1', deletedAt: null }),
      }),
    );
  });

  it('не добавляет deletedAt:null когда includeDeleted=true', async () => {
    const findMany = vi.fn(async (_args: { where: Record<string, unknown> }): Promise<CustomerRow[]> => []);
    const count = vi.fn(async () => 0);
    const prisma = { customer: { findMany, count } };
    const svc = new CustomersService(prisma as never);
    const query = ListCustomersQuerySchema.parse({ includeDeleted: 'true' });
    await svc.list({ tenantId: 'org-1', query });
    const where = findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('q-фильтр кладёт OR по name/inn/email', async () => {
    const findMany = vi.fn(async (_args: { where: { OR?: unknown } }): Promise<CustomerRow[]> => []);
    const count = vi.fn(async () => 0);
    const prisma = { customer: { findMany, count } };
    const svc = new CustomersService(prisma as never);
    const query = ListCustomersQuerySchema.parse({ q: 'альфа' });
    await svc.list({ tenantId: 'org-1', query });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'альфа', mode: 'insensitive' } },
        { inn: { contains: 'альфа', mode: 'insensitive' } },
        { email: { contains: 'альфа', mode: 'insensitive' } },
      ]),
    );
  });

  it('возвращает корректный totalPages при пагинации', async () => {
    const findMany = vi.fn(async () => [buildCustomerRow()]);
    const count = vi.fn(async () => 120);
    const prisma = { customer: { findMany, count } };
    const svc = new CustomersService(prisma as never);
    const query = ListCustomersQuerySchema.parse({ page: '2', limit: '50' });
    const res = await svc.list({ tenantId: 'org-1', query });
    expect(res.page).toBe(2);
    expect(res.limit).toBe(50);
    expect(res.totalPages).toBe(3);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 50 }),
    );
  });
});

describe('CustomersService.getById', () => {
  it('возвращает CustomerDto c metadata', async () => {
    const findUnique = vi.fn(async () =>
      buildCustomerRow({ metadata: { foo: 'bar' } }),
    );
    const prisma = { customer: { findUnique } };
    const svc = new CustomersService(prisma as never);
    const res = await svc.getById({ tenantId: 'org-1', id: 'c-1' });
    expect(res.id).toBe('c-1');
    expect(res.metadata).toEqual({ foo: 'bar' });
  });

  it('404 если клиент в другом tenant', async () => {
    const findUnique = vi.fn(async () => buildCustomerRow({ tenantId: 'other-org' }));
    const prisma = { customer: { findUnique } };
    const svc = new CustomersService(prisma as never);
    await expect(
      svc.getById({ tenantId: 'org-1', id: 'c-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 если клиент не найден', async () => {
    const findUnique = vi.fn(async () => null);
    const prisma = { customer: { findUnique } };
    const svc = new CustomersService(prisma as never);
    await expect(
      svc.getById({ tenantId: 'org-1', id: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
