import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PersonRefResolverService } from './person-ref-resolver.service';

function buildService(): PersonRefResolverService {
  const prisma = {
    person: {
      findMany: vi.fn(async () => [
        { id: 'p-emp', name: 'Марат', userId: 'u-emp' },
        { id: 'p-mgr', name: 'Айназ', userId: null },
      ]),
    },
    bitrixUser: {
      findMany: vi.fn(async () => [{ externalId: 'bx-1', linkedPersonId: 'p-mgr' }]),
    },
    chatboxMember: {
      findMany: vi.fn(async () => [{ externalId: 'cb-1', linkedPersonId: 'p-emp' }]),
    },
  } as unknown as PrismaService;

  return new PersonRefResolverService(prisma);
}

describe('PersonRefResolverService', () => {
  it('резолвит сотрудника по userId', async () => {
    const resolver = await buildService().create('t-1');
    expect(resolver.resolve({ userId: 'u-emp', source: 'checkin' })).toEqual({
      personId: 'p-emp',
      isClient: false,
      personName: 'Марат',
    });
  });

  it('менеджер Битрикс по externalId → сотрудник', async () => {
    const resolver = await buildService().create('t-1');
    expect(resolver.resolve({ source: 'bitrix', externalId: 'bx-1' })).toEqual({
      personId: 'p-mgr',
      isClient: false,
      personName: 'Айназ',
    });
  });

  it('чатбокс-менеджер по externalId → сотрудник', async () => {
    const resolver = await buildService().create('t-1');
    expect(resolver.resolve({ source: 'chatbox', externalId: 'cb-1' })).toEqual({
      personId: 'p-emp',
      isClient: false,
      personName: 'Марат',
    });
  });

  it('клиент чатбокса помечен isClient и без автора', async () => {
    const resolver = await buildService().create('t-1');
    expect(
      resolver.resolve({ source: 'chatbox', externalId: 'cb-client', isClient: true }),
    ).toEqual({
      personId: null,
      isClient: true,
      personName: null,
    });
  });

  it('неизвестный externalId чатбокса → без автора', async () => {
    const resolver = await buildService().create('t-1');
    expect(resolver.resolve({ source: 'chatbox', externalId: 'unknown' })).toEqual({
      personId: null,
      isClient: false,
      personName: null,
    });
  });

  it('неизвестный userId → без автора', async () => {
    const resolver = await buildService().create('t-1');
    expect(resolver.resolve({ userId: 'u-unknown', source: 'checkin' })).toEqual({
      personId: null,
      isClient: false,
      personName: null,
    });
  });

  it('явный personId резолвит имя', async () => {
    const resolver = await buildService().create('t-1');
    expect(resolver.resolve({ personId: 'p-emp', source: 'chat' })).toEqual({
      personId: 'p-emp',
      isClient: false,
      personName: 'Марат',
    });
  });
});
