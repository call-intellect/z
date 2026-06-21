import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PersonLeaveService } from './person-leave.service';

function makeService(findFirstResult: { id: string } | null): {
  svc: PersonLeaveService;
  findFirst: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn(async () => findFirstResult);
  const prisma = {
    personLeave: { findFirst },
  } as unknown as PrismaService;
  const svc = new PersonLeaveService(prisma);
  return { svc, findFirst };
}

describe('PersonLeaveService.isOnLeave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает true, когда дата попала в диапазон отпуска', async () => {
    const { svc, findFirst } = makeService({ id: 'leave1' });
    const result = await svc.isOnLeave({
      tenantId: 't1',
      personId: 'p1',
      date: new Date('2026-06-21T12:30:00.000Z'),
    });
    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          personId: 'p1',
          fromDate: { lte: new Date('2026-06-21T00:00:00.000Z') },
          toDate: { gte: new Date('2026-06-21T00:00:00.000Z') },
        }),
      }),
    );
  });

  it('возвращает false, когда отпуск на дату не найден', async () => {
    const { svc } = makeService(null);
    const result = await svc.isOnLeave({
      tenantId: 't1',
      personId: 'p1',
      date: new Date('2026-06-21T12:30:00.000Z'),
    });
    expect(result).toBe(false);
  });
});
