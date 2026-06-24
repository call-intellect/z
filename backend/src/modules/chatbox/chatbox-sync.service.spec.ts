import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

import type { ChatboxApiClient } from './chatbox-api.client';
import type { ChatboxCustomersService } from './chatbox-customers.service';
import type { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxMembersService } from './chatbox-members.service';
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
    chatboxChat: {
      findFirst: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxMessage: {
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    chatboxChannel: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    person: { findMany: ReturnType<typeof vi.fn> };
    chatboxIntegration: {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    chatboxChatSession: { findMany: ReturnType<typeof vi.fn> };
  };
  let integrationMock: { getConfigForSync: ReturnType<typeof vi.fn> };
  let sessionMock: { rebuildSessions: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
  let analyzeQueueMock: { enqueue: ReturnType<typeof vi.fn> };
  let customersMock: {
    autoLinkUnlinked: ReturnType<typeof vi.fn>;
    autoLinkChannelClients: ReturnType<typeof vi.fn>;
  };
  let membersMock: { autoLinkUnlinked: ReturnType<typeof vi.fn> };
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
      chatboxChat: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'chatdb' }),
        update: vi.fn().mockResolvedValue({ id: 'chatdb' }),
      },
      chatboxMessage: {
        upsert: vi.fn().mockResolvedValue({ id: 'msg1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      chatboxChannel: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
      },
      person: { findMany: vi.fn().mockResolvedValue([]) },
      chatboxIntegration: {
        findUnique: vi.fn().mockResolvedValue({ analysisEnabled: true, lastIncrementalSyncAt: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      chatboxChatSession: { findMany: vi.fn().mockResolvedValue([]) },
    };
    integrationMock = {
      getConfigForSync: vi.fn().mockResolvedValue(CFG),
    };
    sessionMock = { rebuildSessions: vi.fn().mockResolvedValue({ sessionCount: 0 }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };
    analyzeQueueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };
    customersMock = {
      autoLinkUnlinked: vi.fn().mockResolvedValue({ created: 0, linked: 0 }),
      autoLinkChannelClients: vi.fn().mockResolvedValue({ created: 0, linked: 0 }),
    };
    membersMock = {
      autoLinkUnlinked: vi.fn().mockResolvedValue({ created: 0, linked: 0 }),
    };

    service = new ChatboxSyncService(
      prismaMock as unknown as PrismaService,
      clientMock as unknown as ChatboxApiClient,
      integrationMock as unknown as ChatboxIntegrationService,
      sessionMock as unknown as ChatboxSessionService,
      adminMock as unknown as AdminSettingsService,
      analyzeQueueMock as unknown as ChatboxAnalyzeQueueService,
      customersMock as unknown as ChatboxCustomersService,
      membersMock as unknown as ChatboxMembersService,
    );
  });

  it('kill-switch false → syncChats возвращает рано, client не вызван', async () => {
    adminMock.get.mockResolvedValue(false);
    const r = await service.syncChats('t1');
    expect(r.chats).toBe(0);
    expect(r.newChats).toBe(0);
    expect(r.messages).toBe(0);
    expect(r.newMessages).toBe(0);
    expect(clientMock.listChats).not.toHaveBeenCalled();
    expect(integrationMock.getConfigForSync).not.toHaveBeenCalled();
  });

  it('syncChats(since): старый чат первым в выдаче НЕ обрывает синк свежих (continue, не break)', async () => {
    const since = new Date('2026-06-17T00:00:00.000Z');
    clientMock.listChats.mockResolvedValue({
      chats: [
        { id: 'old', channelId: 'ch', status: 'active', createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' },
        { id: 'r1', channelId: 'ch', status: 'active', createdAt: '2026-06-22T00:00:00.000Z', updatedAt: '2026-06-22T07:00:00.000Z' },
        { id: 'r2', channelId: 'ch', status: 'active', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-23T09:00:00.000Z' },
      ],
      total: 3,
    });
    clientMock.listMessages.mockResolvedValue({ messages: [], total: 0 });
    prismaMock.chatboxChat.findFirst.mockResolvedValue(null);
    prismaMock.chatboxMessage.findMany.mockResolvedValue([]);

    const r = await service.syncChats('t1', { since });

    expect(r.chats).toBe(2);
    expect(r.newChats).toBe(2);
    expect(r.messages).toBe(0);
    expect(r.newMessages).toBe(0);
    expect(clientMock.listMessages).toHaveBeenCalledTimes(2);
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

  it('syncMembers: делегирует авто-привязку members.autoLinkUnlinked', async () => {
    clientMock.listMembers.mockResolvedValue({
      members: [{ id: 'a', email: 'A@X.ru', name: 'A', role: 'MANAGER' }],
      total: 1,
    });

    await service.syncMembers('t1');

    expect(membersMock.autoLinkUnlinked).toHaveBeenCalledWith('t1');
    expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });

  it('syncCustomers: upsert по числу + делегирует авто-привязку customers.autoLinkUnlinked', async () => {
    clientMock.listCustomers.mockResolvedValue({
      customers: [
        { id: 'c1', name: 'Клиент', email: 'C@X.ru', phone: '+7900', externalId: null },
      ],
      total: 1,
    });

    const count = await service.syncCustomers('t1');
    expect(count).toBe(1);
    expect(prismaMock.chatboxCustomer.upsert).toHaveBeenCalledTimes(1);
    expect(customersMock.autoLinkUnlinked).toHaveBeenCalledWith('t1');
    expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
  });

  it('incrementalSync: ставит анализ pending+ended сессий и возвращает analysisEnqueued', async () => {
    clientMock.listChannels.mockResolvedValue({ channels: [], total: 0 });
    clientMock.listCustomers.mockResolvedValue({ customers: [], total: 0 });
    clientMock.listChannelClients.mockResolvedValue({ clients: [], total: 0 });
    clientMock.listMembers.mockResolvedValue({ members: [], total: 0 });
    clientMock.listChats.mockResolvedValue({ chats: [], total: 0 });
    prismaMock.chatboxChatSession.findMany.mockResolvedValue([{ id: 'sess1' }, { id: 'sess2' }]);

    const result = await service.incrementalSync('t1');

    expect(prismaMock.chatboxChatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          analysisStatus: 'pending',
          endedAt: { not: null },
        }),
      }),
    );
    expect(analyzeQueueMock.enqueue).toHaveBeenCalledTimes(2);
    expect(analyzeQueueMock.enqueue).toHaveBeenCalledWith('t1', 'sess1');
    expect(analyzeQueueMock.enqueue).toHaveBeenCalledWith('t1', 'sess2');
    expect(result.analysisEnqueued).toBe(2);
  });

  it('incrementalSync: analysisEnabled=false → анализ не ставится', async () => {
    clientMock.listChannels.mockResolvedValue({ channels: [], total: 0 });
    clientMock.listCustomers.mockResolvedValue({ customers: [], total: 0 });
    clientMock.listChannelClients.mockResolvedValue({ clients: [], total: 0 });
    clientMock.listMembers.mockResolvedValue({ members: [], total: 0 });
    clientMock.listChats.mockResolvedValue({ chats: [], total: 0 });
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue({
      analysisEnabled: false,
      lastIncrementalSyncAt: null,
    });

    const result = await service.incrementalSync('t1');

    expect(analyzeQueueMock.enqueue).not.toHaveBeenCalled();
    expect(result.analysisEnqueued).toBe(0);
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
    expect(customersMock.autoLinkChannelClients).toHaveBeenCalledWith('t1');
  });

  it('syncMessages: >1 distinct CLIENT-отправитель → chatboxChat.update получает isGroup=true', async () => {
    clientMock.listMessages.mockResolvedValue({ messages: [], total: 0 });
    prismaMock.chatboxMessage.findMany.mockResolvedValue([
      { senderExternalId: 'tg-1' },
      { senderExternalId: 'tg-2' },
    ]);

    await service.syncMessages('t1', 'chatdb', 'chat-ext');

    expect(prismaMock.chatboxMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          chatId: 'chatdb',
          senderType: 'CLIENT',
          senderExternalId: { not: null },
        }),
        distinct: ['senderExternalId'],
      }),
    );
    expect(prismaMock.chatboxChat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'chatdb' },
        data: expect.objectContaining({ isGroup: true }),
      }),
    );
  });

  it('syncMessages: один CLIENT-отправитель → isGroup=false', async () => {
    clientMock.listMessages.mockResolvedValue({ messages: [], total: 0 });
    prismaMock.chatboxMessage.findMany.mockResolvedValue([{ senderExternalId: 'tg-1' }]);

    await service.syncMessages('t1', 'chatdb', 'chat-ext');

    expect(prismaMock.chatboxChat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isGroup: false }),
      }),
    );
  });
});
