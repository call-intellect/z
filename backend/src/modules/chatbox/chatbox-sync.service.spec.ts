import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';
import type { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';
import type { PersonsService } from '../persons/services/persons.service';

import type { ChatboxApiClient } from './chatbox-api.client';
import type { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxSessionService } from './chatbox-session.service';
import { ChatboxSyncService } from './chatbox-sync.service';
import type { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

const CFG = { workspaceId: 'ws1', token: 'tok', integrationId: 'int1' };

describe('ChatboxSyncService', () => {
  let clientMock: {
    listChannels: ReturnType<typeof vi.fn>;
    listCustomers: ReturnType<typeof vi.fn>;
    listChannelClients: ReturnType<typeof vi.fn>;
    listMembers: ReturnType<typeof vi.fn>;
    listChats: ReturnType<typeof vi.fn>;
    listMessages: ReturnType<typeof vi.fn>;
  };
  let prismaMock: {
    chatboxMember: {
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxCustomer: {
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxChannelClient: {
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxChannel: { findMany: ReturnType<typeof vi.fn> };
    person: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    membership: { findFirst: ReturnType<typeof vi.fn> };
  };
  let integrationMock: { getConfigForSync: ReturnType<typeof vi.fn> };
  let sessionMock: { rebuildSessions: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
  let entityResolutionMock: { resolvePersonByHint: ReturnType<typeof vi.fn> };
  let personsMock: { create: ReturnType<typeof vi.fn> };
  let analyzeQueueMock: { enqueue: ReturnType<typeof vi.fn> };
  let service: ChatboxSyncService;

  beforeEach(() => {
    clientMock = {
      listChannels: vi.fn(),
      listCustomers: vi.fn(),
      listChannelClients: vi.fn(),
      listMembers: vi.fn(),
      listChats: vi.fn(),
      listMessages: vi.fn(),
    };
    prismaMock = {
      chatboxMember: {
        upsert: vi.fn().mockResolvedValue({ id: 'mem1' }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: 'mem1' }),
      },
      chatboxCustomer: {
        upsert: vi.fn().mockResolvedValue({ id: 'cus1' }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: 'cus1' }),
      },
      chatboxChannelClient: {
        upsert: vi.fn().mockResolvedValue({ id: 'cc1' }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: 'cc1' }),
      },
      chatboxChannel: { findMany: vi.fn().mockResolvedValue([]) },
      person: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      membership: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    integrationMock = {
      getConfigForSync: vi.fn().mockResolvedValue(CFG),
    };
    sessionMock = { rebuildSessions: vi.fn().mockResolvedValue({ sessionCount: 0 }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };
    entityResolutionMock = { resolvePersonByHint: vi.fn().mockResolvedValue(null) };
    personsMock = { create: vi.fn().mockResolvedValue({ id: 'p1' }) };
    analyzeQueueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };

    service = new ChatboxSyncService(
      prismaMock as unknown as PrismaService,
      clientMock as unknown as ChatboxApiClient,
      integrationMock as unknown as ChatboxIntegrationService,
      sessionMock as unknown as ChatboxSessionService,
      adminMock as unknown as AdminSettingsService,
      entityResolutionMock as unknown as EntityResolutionService,
      personsMock as unknown as PersonsService,
      analyzeQueueMock as unknown as ChatboxAnalyzeQueueService,
    );
  });

  it('kill-switch false → syncChats возвращает рано, client не вызван', async () => {
    adminMock.get.mockResolvedValue(false);
    const count = await service.syncChats('t1');
    expect(count).toBe(0);
    expect(clientMock.listChats).not.toHaveBeenCalled();
    expect(integrationMock.getConfigForSync).not.toHaveBeenCalled();
  });

  it('syncMembers: upsert по числу members, linkedPersonId не в data', async () => {
    clientMock.listMembers.mockResolvedValue({
      members: [
        { id: 'a', email: 'a@x.ru', name: 'A', role: 'MANAGER', createdAt: '2026-01-01' },
        { id: 'b', email: 'b@x.ru', name: 'B', role: 'USER', createdAt: '2026-01-01' },
      ],
      total: 2,
    });

    const count = await service.syncMembers('t1');
    expect(count).toBe(2);
    expect(prismaMock.chatboxMember.upsert).toHaveBeenCalledTimes(2);

    const firstCall = prismaMock.chatboxMember.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(firstCall.create).toEqual(
      expect.objectContaining({
        tenantId: 't1',
        externalId: 'a',
        email: 'a@x.ru',
        name: 'A',
        role: 'MANAGER',
      }),
    );
    expect(firstCall.create).not.toHaveProperty('linkedPersonId');
    expect(firstCall.create).not.toHaveProperty('linkMode');
    expect(firstCall.update).not.toHaveProperty('linkedPersonId');
  });

  it('syncMembers: автосвязка — member с email и найденной Person → linkedPersonId + linkMode=auto', async () => {
    clientMock.listMembers.mockResolvedValue({
      members: [{ id: 'a', email: 'A@X.ru', name: 'A', role: 'MANAGER' }],
      total: 1,
    });
    prismaMock.chatboxMember.findMany.mockResolvedValue([
      { id: 'mem-a', email: 'A@X.ru', linkedPersonId: null },
    ]);
    prismaMock.person.findMany.mockResolvedValue([{ id: 'p1', email: 'a@x.ru' }]);

    await service.syncMembers('t1');

    expect(prismaMock.person.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem-a' },
        data: { linkedPersonId: 'p1', linkMode: 'auto' },
      }),
    );
  });

  it('syncMembers: автосвязка НЕ перетирает ручную связку (manual исключён из кандидатов)', async () => {
    clientMock.listMembers.mockResolvedValue({
      members: [{ id: 'a', email: 'A@X.ru', name: 'A', role: 'MANAGER' }],
      total: 1,
    });
    prismaMock.chatboxMember.findMany.mockResolvedValue([]);

    await service.syncMembers('t1');

    expect(prismaMock.chatboxMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          linkMode: { not: 'manual' },
        }),
      }),
    );
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
    expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
  });

  describe('Ф1 — имя-каскад автосвязки членов', () => {
    it('email пуст, но имя однозначно совпало → linkedPersonId + linkMode=auto', async () => {
      clientMock.listMembers.mockResolvedValue({
        members: [{ id: 'a', email: null, name: 'Иван Петров', role: 'MANAGER' }],
        total: 1,
      });
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        { id: 'mem-a', email: null, name: 'Иван Петров', linkedPersonId: null },
      ]);
      entityResolutionMock.resolvePersonByHint.mockResolvedValue('p-name');

      await service.syncMembers('t1');

      expect(entityResolutionMock.resolvePersonByHint).toHaveBeenCalledWith('t1', 'Иван Петров');
      expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mem-a' },
          data: { linkedPersonId: 'p-name', linkMode: 'auto' },
        }),
      );
    });

    it('имя неоднозначно (resolvePersonByHint→null) → НЕ связывает', async () => {
      clientMock.listMembers.mockResolvedValue({
        members: [{ id: 'a', email: null, name: 'Иван', role: 'MANAGER' }],
        total: 1,
      });
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        { id: 'mem-a', email: null, name: 'Иван', linkedPersonId: null },
      ]);
      entityResolutionMock.resolvePersonByHint.mockResolvedValue(null);

      await service.syncMembers('t1');

      expect(entityResolutionMock.resolvePersonByHint).toHaveBeenCalledTimes(1);
      expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
    });

    it('флаг name_fuzzy OFF → имя-ступень не выполняется (resolvePersonByHint не зовётся)', async () => {
      adminMock.get.mockImplementation(async (key: string, def?: unknown) => {
        if (key === 'chatbox.match.name_fuzzy_enabled') return false;
        return def ?? true;
      });
      clientMock.listMembers.mockResolvedValue({
        members: [{ id: 'a', email: null, name: 'Иван Петров', role: 'MANAGER' }],
        total: 1,
      });
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        { id: 'mem-a', email: null, name: 'Иван Петров', linkedPersonId: null },
      ]);

      await service.syncMembers('t1');

      expect(entityResolutionMock.resolvePersonByHint).not.toHaveBeenCalled();
      expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
    });

    it('email-ступень имеет приоритет: совпал email → имя-резолвер не зовётся', async () => {
      clientMock.listMembers.mockResolvedValue({
        members: [{ id: 'a', email: 'a@x.ru', name: 'Иван', role: 'MANAGER' }],
        total: 1,
      });
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        { id: 'mem-a', email: 'a@x.ru', name: 'Иван', linkedPersonId: null },
      ]);
      prismaMock.person.findMany.mockResolvedValue([{ id: 'p1', email: 'a@x.ru' }]);

      await service.syncMembers('t1');

      expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { linkedPersonId: 'p1', linkMode: 'auto' },
        }),
      );
      expect(entityResolutionMock.resolvePersonByHint).not.toHaveBeenCalled();
    });
  });

  describe('Ф1 — автосвязка клиентов (syncCustomers / syncChannelClients)', () => {
    it('syncCustomers: клиент с email → ChatboxCustomer.update linkMode=auto', async () => {
      clientMock.listCustomers.mockResolvedValue({
        customers: [
          { id: 'c1', name: 'Клиент', email: 'C@X.ru', phone: '+7900', externalId: null },
        ],
        total: 1,
      });
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        { id: 'cus-1', email: 'C@X.ru', name: 'Клиент', linkedPersonId: null },
      ]);
      prismaMock.person.findMany.mockResolvedValue([{ id: 'p1', email: 'c@x.ru' }]);

      const count = await service.syncCustomers('t1');
      expect(count).toBe(1);
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cus-1' },
          data: { linkedPersonId: 'p1', linkMode: 'auto' },
        }),
      );
    });

    it('syncCustomers: имя-fuzzy для клиента без email → update по имени', async () => {
      clientMock.listCustomers.mockResolvedValue({
        customers: [{ id: 'c1', name: 'ООО Ромашка', email: null, phone: null, externalId: null }],
        total: 1,
      });
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        { id: 'cus-1', email: null, name: 'ООО Ромашка', linkedPersonId: null },
      ]);
      entityResolutionMock.resolvePersonByHint.mockResolvedValue('p-name');

      await service.syncCustomers('t1');

      expect(entityResolutionMock.resolvePersonByHint).toHaveBeenCalledWith('t1', 'ООО Ромашка');
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { linkedPersonId: 'p-name', linkMode: 'auto' },
        }),
      );
    });

    it('syncCustomers: автосвязка исключает manual (фильтр в findMany)', async () => {
      clientMock.listCustomers.mockResolvedValue({
        customers: [{ id: 'c1', name: 'Клиент', email: 'c@x.ru', phone: null, externalId: null }],
        total: 1,
      });
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([]);

      await service.syncCustomers('t1');

      expect(prismaMock.chatboxCustomer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            linkMode: { not: 'manual' },
          }),
        }),
      );
      expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    });

    it('syncChannelClients: собеседник канала с email → ChatboxChannelClient.update auto', async () => {
      clientMock.listChannelClients.mockResolvedValue({
        clients: [
          {
            id: 'cc1',
            customerId: null,
            channelType: 'TELEGRAM',
            channelId: null,
            externalId: 'tg-1',
            name: 'Собеседник',
            email: 'cc@x.ru',
            phone: null,
            avatarUrl: null,
            isBlocked: false,
          },
        ],
        total: 1,
      });
      prismaMock.chatboxChannelClient.findMany.mockResolvedValue([
        { id: 'cli-1', email: 'cc@x.ru', name: 'Собеседник', linkedPersonId: null },
      ]);
      prismaMock.person.findMany.mockResolvedValue([{ id: 'p2', email: 'cc@x.ru' }]);

      await service.syncChannelClients('t1');

      expect(prismaMock.chatboxChannelClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cli-1' },
          data: { linkedPersonId: 'p2', linkMode: 'auto' },
        }),
      );
    });
  });
});
