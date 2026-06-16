import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';
import type { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';
import type { PersonsService } from '../persons/services/persons.service';

import type { BitrixIntegrationService } from './bitrix-integration.service';
import { BitrixSyncService } from './bitrix-sync.service';

/**
 * Unit-тесты сопоставления сотрудников BitrixSyncService (ТЗ 2026-06-17, Ф5):
 * listUsers + linkUser (link/unlink/create). Prisma/Persons замоканы.
 */
function makeService(over: { prisma?: Record<string, unknown> } = {}): {
  service: BitrixSyncService;
  prisma: any;
  persons: any;
} {
  const prisma = {
    bitrixUser: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    person: { findMany: vi.fn(), findFirst: vi.fn() },
    membership: { findFirst: vi.fn() },
    ...over.prisma,
  };
  const persons = { create: vi.fn() };
  const service = new BitrixSyncService(
    prisma as unknown as PrismaService,
    {} as unknown as BitrixIntegrationService,
    {} as unknown as AdminSettingsService,
    {} as unknown as EntityResolutionService,
    persons as unknown as PersonsService,
    undefined,
  );
  return { service, prisma, persons };
}

describe('BitrixSyncService.listUsers', () => {
  it('возвращает сотрудников с linkedPersonName + кандидатов Person', async () => {
    const { service, prisma } = makeService();
    prisma.bitrixUser.findMany.mockResolvedValue([
      {
        externalId: '1',
        name: 'Иван',
        email: 'i@x.ru',
        position: 'Менеджер',
        active: true,
        linkMode: 'manual',
        linkedPersonId: 'p1',
      },
      {
        externalId: '2',
        name: 'Пётр',
        email: null,
        position: null,
        active: true,
        linkMode: 'none',
        linkedPersonId: null,
      },
    ]);
    prisma.person.findMany
      .mockResolvedValueOnce([{ id: 'p1', name: 'Иван Иванов' }]) // linked names
      .mockResolvedValueOnce([{ id: 'p1', name: 'Иван Иванов', email: 'i@x.ru' }]); // candidates

    const res = await service.listUsers('t1');

    expect(res.users[0]!.linkedPersonName).toBe('Иван Иванов');
    expect(res.users[1]!.linkedPersonName).toBeNull();
    expect(res.personCandidates).toHaveLength(1);
  });
});

describe('BitrixSyncService.linkUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mode=link → ставит linkedPersonId + linkMode=manual (валидирует Person)', async () => {
    const { service, prisma } = makeService();
    prisma.bitrixUser.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Иван',
      email: 'i@x.ru',
    });
    prisma.person.findFirst
      .mockResolvedValueOnce({ id: 'p1' }) // валидация принадлежности org
      .mockResolvedValueOnce({ name: 'Иван Иванов' }); // имя для ответа
    prisma.bitrixUser.update.mockResolvedValue({
      externalId: '1',
      name: 'Иван',
      email: 'i@x.ru',
      position: null,
      active: true,
      linkMode: 'manual',
      linkedPersonId: 'p1',
    });

    const res = await service.linkUser('t1', '1', 'link', 'p1');

    expect(prisma.bitrixUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { linkedPersonId: 'p1', linkMode: 'manual' },
      }),
    );
    expect(res.linkedPersonName).toBe('Иван Иванов');
  });

  it('mode=unlink → linkedPersonId=null, linkMode=manual', async () => {
    const { service, prisma } = makeService();
    prisma.bitrixUser.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Иван',
      email: null,
    });
    prisma.bitrixUser.update.mockResolvedValue({
      externalId: '1',
      name: 'Иван',
      email: null,
      position: null,
      active: true,
      linkMode: 'manual',
      linkedPersonId: null,
    });

    const res = await service.linkUser('t1', '1', 'unlink');

    expect(prisma.bitrixUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { linkedPersonId: null, linkMode: 'manual' },
      }),
    );
    expect(res.linkedPersonName).toBeNull();
  });

  it('mode=create → создаёт Person (owner) и привязывает', async () => {
    const { service, prisma, persons } = makeService();
    prisma.bitrixUser.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Иван',
      email: 'i@x.ru',
    });
    prisma.membership.findFirst.mockResolvedValue({ userId: 'owner1' });
    persons.create.mockResolvedValue({ id: 'pNew' });
    prisma.person.findFirst.mockResolvedValue({ name: 'Иван' });
    prisma.bitrixUser.update.mockResolvedValue({
      externalId: '1',
      name: 'Иван',
      email: 'i@x.ru',
      position: null,
      active: true,
      linkMode: 'manual',
      linkedPersonId: 'pNew',
    });

    await service.linkUser('t1', '1', 'create');

    expect(persons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        userId: 'owner1',
        body: expect.objectContaining({ name: 'Иван', email: 'i@x.ru' }),
      }),
    );
    expect(prisma.bitrixUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { linkedPersonId: 'pNew', linkMode: 'manual' },
      }),
    );
  });

  it('сотрудник не найден → NotFoundException', async () => {
    const { service, prisma } = makeService();
    prisma.bitrixUser.findUnique.mockResolvedValue(null);
    await expect(service.linkUser('t1', 'X', 'unlink')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('mode=link с несуществующим Person → BadRequestException', async () => {
    const { service, prisma } = makeService();
    prisma.bitrixUser.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Иван',
      email: null,
    });
    prisma.person.findFirst.mockResolvedValue(null);
    await expect(
      service.linkUser('t1', '1', 'link', 'ghost'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
