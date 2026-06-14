/**
 * Юнит-тесты guard-веток `PersonsService.create({ linkUserId })`
 * (ТЗ «Команда + доступы» Фаза 2 — привязка карточки к участнику).
 *
 * Обе ветки кидают ДО `$transaction`, поэтому транзакцию мокать не нужно —
 * достаточно `membership.findUnique` и `person.findFirst`.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PersonsService } from './persons.service';

const auditStub = { log: vi.fn(async () => undefined) } as never;
const cfgStub = { persons: { useAppointment: false } } as never;

function buildPrismaStub(opts: {
  membershipFindUnique?: (args: unknown) => Promise<unknown>;
  personFindFirst?: (args: unknown) => Promise<unknown>;
}) {
  return {
    membership: {
      findUnique: vi.fn(opts.membershipFindUnique ?? (async () => null)),
    },
    person: {
      findFirst: vi.fn(opts.personFindFirst ?? (async () => null)),
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(),
  };
}

describe('PersonsService.create — linkUserId guard', () => {
  it('linkUserId без membership → BadRequestException (400)', async () => {
    const prisma = buildPrismaStub({ membershipFindUnique: async () => null });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    await expect(
      svc.create({
        tenantId: 'org-1',
        userId: 'actor',
        body: { name: 'Карточка', linkUserId: 'u-1' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('linkUserId есть, но карточка уже привязана → ConflictException', async () => {
    const prisma = buildPrismaStub({
      membershipFindUnique: async () => ({ userId: 'u-1' }),
      personFindFirst: async () => ({ id: 'p-existing' }),
    });
    const svc = new PersonsService(prisma as never, auditStub, cfgStub);

    await expect(
      svc.create({
        tenantId: 'org-1',
        userId: 'actor',
        body: { name: 'Карточка', linkUserId: 'u-1' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
