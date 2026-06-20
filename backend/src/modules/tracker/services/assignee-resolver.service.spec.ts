import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AssigneeResolverService } from './assignee-resolver.service';

const TENANT = 'org_1';

describe('AssigneeResolverService.resolve', () => {
  let prisma: PrismaService;
  let service: AssigneeResolverService;
  let membershipFindMany: ReturnType<typeof vi.fn>;
  let personFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    membershipFindMany = vi.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
    personFindMany = vi.fn(async () => [
      { userId: 'u1', name: 'Айназ' },
      { userId: 'u2', name: 'Иван' },
    ]);
    prisma = {
      membership: { findMany: membershipFindMany },
      person: { findMany: personFindMany },
    } as unknown as PrismaService;
    service = new AssigneeResolverService(prisma);
  });

  it('1 точное совпадение → resolved', async () => {
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Айназ' });
  });

  it('точное равенство приоритетнее частичного', async () => {
    personFindMany.mockResolvedValueOnce([
      { userId: 'u1', name: 'Иван' },
      { userId: 'u2', name: 'Иванов Иван' },
    ]);
    const r = await service.resolve(TENANT, 'Иван');
    expect(r).toEqual({ kind: 'resolved', userId: 'u1', name: 'Иван' });
  });

  it('2 одноимённых (разные userId) → ambiguous со списком', async () => {
    personFindMany.mockResolvedValueOnce([
      { userId: 'u1', name: 'Айназ' },
      { userId: 'u2', name: 'Айназ' },
    ]);
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates.map((c) => c.userId).sort()).toEqual(['u1', 'u2']);
    }
  });

  it('0 совпадений → not_found', async () => {
    const r = await service.resolve(TENANT, 'Пётр');
    expect(r).toEqual({ kind: 'not_found' });
  });

  it('пустое имя → not_found', async () => {
    const r = await service.resolve(TENANT, '   ');
    expect(r).toEqual({ kind: 'not_found' });
  });

  it('cross-tenant: person.findMany фильтруется по tenantId+deletedAt', async () => {
    await service.resolve(TENANT, 'Айназ');
    expect(personFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      }),
    );
  });

  it('person без активного Membership исключается (membership-gate)', async () => {
    membershipFindMany.mockResolvedValueOnce([{ userId: 'u2' }]);
    personFindMany.mockResolvedValueOnce([{ userId: 'u1', name: 'Айназ' }]);
    const r = await service.resolve(TENANT, 'Айназ');
    expect(r).toEqual({ kind: 'not_found' });
  });
});
