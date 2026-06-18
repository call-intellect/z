import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { PersonsService } from './persons.service';

const auditStub = { log: vi.fn(async () => undefined) } as never;
const cfgStub = { persons: { useAppointment: false } } as never;

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PersonsService.ensurePersonForUser', () => {
  it('(а) существующая Person по userId → возвращается, ничего не создаётся', async () => {
    const prisma = {
      person: {
        findFirst: vi.fn(async () => ({ id: 'p-existing' })),
        create: vi.fn(),
        update: vi.fn(),
      },
      membership: { findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
    };
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    const res = await svc.ensurePersonForUser({ tenantId: 'org-1', userId: 'u-1' });

    expect(res).toEqual({ id: 'p-existing' });
    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('(б) осиротевшая Person через membership.personId → линкуется userId', async () => {
    const prisma = {
      person: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p-orphan' }),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      membership: {
        findUnique: vi.fn(async () => ({ personId: 'p-orphan' })),
      },
      user: { findUnique: vi.fn() },
    };
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    const res = await svc.ensurePersonForUser({ tenantId: 'org-1', userId: 'u-1' });

    expect(res).toEqual({ id: 'p-orphan' });
    expect(prisma.person.update).toHaveBeenCalledWith({
      where: { id: 'p-orphan' },
      data: { userId: 'u-1' },
    });
    expect(prisma.person.create).not.toHaveBeenCalled();
  });

  it('(в) нет Person → создаётся с name/email из User, relationship=employee', async () => {
    const prisma = {
      person: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'p-new' })),
        update: vi.fn(),
      },
      membership: { findUnique: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () => ({ email: 'owner@x.test', name: 'Влад' })),
      },
    };
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    const res = await svc.ensurePersonForUser({ tenantId: 'org-1', userId: 'u-1' });

    expect(res).toEqual({ id: 'p-new' });
    expect(prisma.person.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'org-1',
          userId: 'u-1',
          name: 'Влад',
          email: 'owner@x.test',
          relationship: 'employee',
        }),
      }),
    );
  });

  it('(в2) User без name/email → пустые строки fallback', async () => {
    const prisma = {
      person: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'p-new' })),
        update: vi.fn(),
      },
      membership: { findUnique: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => null) },
    };
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    await svc.ensurePersonForUser({ tenantId: 'org-1', userId: 'u-1' });

    expect(prisma.person.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '', email: '' }),
      }),
    );
  });

  it('(г) P2002 на email → линкует существующую безличную карточку', async () => {
    const prisma = {
      person: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'p-byemail', userId: null }),
        create: vi.fn(async () => {
          throw p2002();
        }),
        update: vi.fn(async () => ({})),
      },
      membership: { findUnique: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () => ({ email: 'dup@x.test', name: 'Дубль' })),
      },
    };
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    const res = await svc.ensurePersonForUser({ tenantId: 'org-1', userId: 'u-1' });

    expect(res).toEqual({ id: 'p-byemail' });
    expect(prisma.person.update).toHaveBeenCalledWith({
      where: { id: 'p-byemail' },
      data: { userId: 'u-1' },
    });
  });

  it('(г2) P2002, но Person появилась по userId (гонка) → возвращается без линковки по email', async () => {
    const prisma = {
      person: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p-raced' }),
        create: vi.fn(async () => {
          throw p2002();
        }),
        update: vi.fn(),
      },
      membership: { findUnique: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () => ({ email: 'r@x.test', name: 'Гонка' })),
      },
    };
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    const res = await svc.ensurePersonForUser({ tenantId: 'org-1', userId: 'u-1' });

    expect(res).toEqual({ id: 'p-raced' });
    expect(prisma.person.update).not.toHaveBeenCalled();
  });
});
