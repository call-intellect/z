import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { backfillOwnerPerson } from './backfill-owner-person';

function buildPrisma(opts: {
  memberships: { id: string; orgId: string; userId: string; personId: string | null }[];
  personByUser?: (tenantId: string, userId: string) => { id: string } | null;
}) {
  let served = false;
  const personFindFirst = vi.fn(async (args: { where: { userId?: string; tenantId?: string } }) => {
    const found = opts.personByUser?.(args.where.tenantId ?? '', args.where.userId ?? '') ?? null;
    return found;
  });
  const prisma = {
    membership: {
      findMany: vi.fn(async () => {
        if (served) return [];
        served = true;
        return opts.memberships;
      }),
      update: vi.fn(async () => ({})),
    },
    person: {
      findFirst: personFindFirst,
      create: vi.fn(async () => ({ id: 'p-created' })),
      update: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async () => ({ email: 'o@x.test', name: 'Влад' })),
    },
  };
  return prisma;
}

describe('backfillOwnerPerson', () => {
  it('dry-run: считает кандидатов, ничего не пишет', async () => {
    const prisma = buildPrisma({
      memberships: [{ id: 'm-1', orgId: 'org-1', userId: 'u-1', personId: null }],
    });

    const stats = await backfillOwnerPerson(prisma as unknown as PrismaClient, {
      apply: false,
    });

    expect(stats.membershipsScanned).toBe(1);
    expect(stats.personsCreated).toBe(1);
    expect(stats.membershipsUpdated).toBe(1);
    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(prisma.membership.update).not.toHaveBeenCalled();
  });

  it('apply: создаёт Person и проставляет membership.personId', async () => {
    const prisma = buildPrisma({
      memberships: [{ id: 'm-1', orgId: 'org-1', userId: 'u-1', personId: null }],
    });

    const stats = await backfillOwnerPerson(prisma as unknown as PrismaClient, {
      apply: true,
    });

    expect(stats.personsCreated).toBe(1);
    expect(stats.membershipsUpdated).toBe(1);
    expect(prisma.person.create).toHaveBeenCalledOnce();
    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { personId: 'p-created' },
    });
  });

  it('идемпотентность: нет Membership без personId → 0 действий', async () => {
    const prisma = buildPrisma({ memberships: [] });

    const stats = await backfillOwnerPerson(prisma as unknown as PrismaClient, {
      apply: true,
    });

    expect(stats.membershipsScanned).toBe(0);
    expect(stats.personsCreated).toBe(0);
    expect(stats.membershipsUpdated).toBe(0);
    expect(prisma.person.create).not.toHaveBeenCalled();
  });

  it('Person по userId уже есть → только linking, create не вызывается', async () => {
    const prisma = buildPrisma({
      memberships: [{ id: 'm-1', orgId: 'org-1', userId: 'u-1', personId: null }],
      personByUser: () => ({ id: 'p-existing' }),
    });

    const stats = await backfillOwnerPerson(prisma as unknown as PrismaClient, {
      apply: true,
    });

    expect(stats.personsCreated).toBe(0);
    expect(stats.membershipsUpdated).toBe(1);
    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { personId: 'p-existing' },
    });
  });
});
