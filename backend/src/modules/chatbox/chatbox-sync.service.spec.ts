import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

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
      update: ReturnType<typeof vi.fn>;
    };
    chatboxCustomer: {
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxChannelClient: {
      findMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxChannel: { findMany: ReturnType<typeof vi.fn> };
    person: { findMany: ReturnType<typeof vi.fn> };
  };
  let integrationMock: { getConfigForSync: ReturnType<typeof vi.fn> };
  let sessionMock: { rebuildSessions: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
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
        update: vi.fn().mockResolvedValue({ id: 'mem1' }),
      },
      chatboxCustomer: {
        upsert: vi.fn().mockResolvedValue({ id: 'cus1' }),
        update: vi.fn().mockResolvedValue({ id: 'cus1' }),
      },
      chatboxChannelClient: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: 'cc1' }),
        update: vi.fn().mockResolvedValue({ id: 'cc1' }),
      },
      chatboxChannel: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    };
    integrationMock = {
      getConfigForSync: vi.fn().mockResolvedValue(CFG),
    };
    sessionMock = { rebuildSessions: vi.fn().mockResolvedValue({ sessionCount: 0 }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };
    analyzeQueueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };

    service = new ChatboxSyncService(
      prismaMock as unknown as PrismaService,
      clientMock as unknown as ChatboxApiClient,
      integrationMock as unknown as ChatboxIntegrationService,
      sessionMock as unknown as ChatboxSessionService,
      adminMock as unknown as AdminSettingsService,
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

  it('syncMembers: upsert по числу members, linkedPersonId/linkMode не в data', async () => {
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

  it('syncMembers: НЕ сопоставляет автоматически (update/person.findMany не зовутся)', async () => {
    clientMock.listMembers.mockResolvedValue({
      members: [{ id: 'a', email: 'A@X.ru', name: 'A', role: 'MANAGER' }],
      total: 1,
    });

    await service.syncMembers('t1');

    expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });

  it('syncCustomers: upsert по числу, НЕ сопоставляет автоматически (update не зовётся)', async () => {
    clientMock.listCustomers.mockResolvedValue({
      customers: [
        { id: 'c1', name: 'Клиент', email: 'C@X.ru', phone: '+7900', externalId: null },
      ],
      total: 1,
    });

    const count = await service.syncCustomers('t1');
    expect(count).toBe(1);
    expect(prismaMock.chatboxCustomer.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });

  it('syncChannelClients: upsert по числу, НЕ сопоставляет автоматически (update не зовётся)', async () => {
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

    const count = await service.syncChannelClients('t1');
    expect(count).toBe(1);
    expect(prismaMock.chatboxChannelClient.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.chatboxChannelClient.update).not.toHaveBeenCalled();
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });
});
