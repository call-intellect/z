import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import type { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxChatsService } from './chatbox-chats.service';
import type { ChatboxIntegrationService } from './chatbox-integration.service';

/**
 * Детерминированные unit-тесты ChatboxChatsService: Prisma / ChatboxApiClient /
 * ChatboxIntegrationService полностью замоканы — БД/сети нет.
 *
 * Проверяем:
 *  - listChats: маппинг DTO + батч-резолв имён (findMany по customer/member/
 *    channelClient вызван НЕ в цикле — по одному разу).
 *  - getChat: нет чата → chatbox_chat_not_found; есть → sessions +
 *    messengerIdentities.
 *  - sendMessage: успех → client.sendMessage + upsert(isOutboundFromKora:true,
 *    senderType:'USER') + chat.update; ошибка client → chatbox_send_failed
 *    (БД не трогаем); нет интеграции → chatbox_not_configured.
 */

function makeService(
  over: {
    prisma?: Partial<Record<string, unknown>>;
    client?: Partial<ChatboxApiClient>;
    integration?: Partial<ChatboxIntegrationService>;
  } = {},
): {
  service: ChatboxChatsService;
  prisma: any;
  client: any;
  integration: any;
} {
  const prisma = {
    chatboxChat: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    chatboxMessage: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    chatboxCustomer: { findMany: vi.fn(), findFirst: vi.fn() },
    chatboxMember: { findMany: vi.fn(), findFirst: vi.fn() },
    chatboxChannelClient: { findMany: vi.fn(), findFirst: vi.fn() },
    chatboxChatSession: { findMany: vi.fn() },
    ...over.prisma,
  };
  const client = { sendMessage: vi.fn(), ...over.client };
  const integration = { getConfigForSync: vi.fn(), ...over.integration };
  const service = new ChatboxChatsService(
    prisma as unknown as PrismaService,
    client as unknown as ChatboxApiClient,
    integration as unknown as ChatboxIntegrationService,
  );
  return { service, prisma, client, integration };
}

describe('ChatboxChatsService.listChats', () => {
  it('маппит DTO и резолвит имена батчем (без N+1)', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findMany.mockResolvedValue([
      {
        id: 'db1',
        externalId: 'ext1',
        channelType: 'TELEGRAM',
        status: 'ACTIVE',
        customerExternalId: 'cust1',
        clientExternalId: 'cli1',
        responsibleExternalId: 'mem1',
        lastMessageAt: new Date('2026-06-04T10:00:00.000Z'),
        messageCount: 3,
        externalCreatedAt: new Date('2026-06-01T08:00:00.000Z'),
      },
      {
        id: 'db2',
        externalId: 'ext2',
        channelType: 'TELEGRAM',
        status: 'ACTIVE',
        customerExternalId: 'cust1', // тот же кастомер — дедуп
        clientExternalId: null,
        responsibleExternalId: null,
        lastMessageAt: null,
        messageCount: 0,
        externalCreatedAt: null,
      },
    ]);
    prisma.chatboxChat.count.mockResolvedValue(2);
    prisma.chatboxCustomer.findMany.mockResolvedValue([
      { externalId: 'cust1', name: 'Arsenii' },
    ]);
    prisma.chatboxMember.findMany.mockResolvedValue([
      { externalId: 'mem1', name: 'Никита' },
    ]);
    prisma.chatboxChannelClient.findMany.mockResolvedValue([
      { externalId: 'cli1', name: 'tg-Arsenii' },
    ]);

    const out = await service.listChats('t1', {});

    expect(out.total).toBe(2);
    expect(out.items[0]).toEqual(
      expect.objectContaining({
        id: 'db1',
        externalId: 'ext1',
        customer: { externalId: 'cust1', name: 'Arsenii' },
        clientName: 'tg-Arsenii',
        responsible: { externalId: 'mem1', name: 'Никита' },
        lastMessageAt: '2026-06-04T10:00:00.000Z',
        messageCount: 3,
      }),
    );
    expect(out.items[1]).toEqual(
      expect.objectContaining({
        responsible: null,
        clientName: null,
        lastMessageAt: null,
      }),
    );

    // Батч: каждый резолвер вызван РОВНО один раз (не на каждый чат).
    expect(prisma.chatboxCustomer.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.chatboxMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.chatboxChannelClient.findMany).toHaveBeenCalledTimes(1);
    // Дедуп уникальных id (cust1 один раз).
    expect(prisma.chatboxCustomer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          externalId: { in: ['cust1'] },
        }),
      }),
    );
  });

  it('применяет фильтры status/channelType/customerExternalId в where', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findMany.mockResolvedValue([]);
    prisma.chatboxChat.count.mockResolvedValue(0);

    await service.listChats('t1', {
      status: 'closed',
      channelType: 'TELEGRAM',
      customerExternalId: 'cust9',
    });

    expect(prisma.chatboxChat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 't1',
          status: 'closed',
          channelType: 'TELEGRAM',
          customerExternalId: 'cust9',
        },
      }),
    );
  });
});

describe('ChatboxChatsService.getChat', () => {
  it('нет чата → chatbox_chat_not_found', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue(null);

    await expect(service.getChat('t1', 'nope')).rejects.toMatchObject({
      response: { error: { code: 'chatbox_chat_not_found' } },
    });
  });

  it('есть чат → возвращает sessions + messengerIdentities', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      channelType: 'TELEGRAM',
      status: 'ACTIVE',
      customerExternalId: 'cust1',
      clientExternalId: 'cli1',
      responsibleExternalId: 'mem1',
      lastMessageAt: new Date('2026-06-04T10:00:00.000Z'),
      messageCount: 5,
      externalCreatedAt: new Date('2026-06-01T08:00:00.000Z'),
      externalUpdatedAt: new Date('2026-06-04T10:00:00.000Z'),
    });
    prisma.chatboxCustomer.findFirst.mockResolvedValue({
      externalId: 'cust1',
      name: 'Arsenii',
    });
    prisma.chatboxMember.findFirst.mockResolvedValue({
      externalId: 'mem1',
      name: 'Никита',
      linkedPersonId: 'p1',
    });
    prisma.chatboxChatSession.findMany.mockResolvedValue([
      {
        id: 's1',
        seq: 1,
        startedAt: new Date('2026-06-01T08:00:00.000Z'),
        endedAt: new Date('2026-06-02T08:00:00.000Z'),
        summary: 'итог',
        analysisStatus: 'done',
        previousSessionId: null,
      },
    ]);
    // первый findMany — messengerIdentities; findFirst — clientName
    prisma.chatboxChannelClient.findMany.mockResolvedValue([
      {
        channelType: 'TELEGRAM',
        externalId: 'cli1',
        name: 'tg-Arsenii',
        avatarUrl: 'http://a/1.png',
      },
      {
        channelType: 'EXT_MAX',
        externalId: 'cli2',
        name: 'max-Arsenii',
        avatarUrl: null,
      },
    ]);
    prisma.chatboxChannelClient.findFirst.mockResolvedValue({
      name: 'tg-Arsenii',
    });

    const out = await service.getChat('t1', 'db1');

    expect(out.id).toBe('db1');
    expect(out.customer).toEqual({ externalId: 'cust1', name: 'Arsenii' });
    expect(out.responsible).toEqual({ externalId: 'mem1', name: 'Никита' });
    expect(out.clientName).toBe('tg-Arsenii');
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toEqual(
      expect.objectContaining({ id: 's1', seq: 1, summary: 'итог' }),
    );
    expect(out.messengerIdentities).toHaveLength(2);
    expect(out.messengerIdentities[0]).toEqual({
      channelType: 'TELEGRAM',
      externalId: 'cli1',
      name: 'tg-Arsenii',
      avatarUrl: 'http://a/1.png',
    });
  });
});

describe('ChatboxChatsService.listMessages', () => {
  it('нет чата → chatbox_chat_not_found', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue(null);

    await expect(
      service.listMessages('t1', 'nope', {}),
    ).rejects.toMatchObject({
      response: { error: { code: 'chatbox_chat_not_found' } },
    });
  });

  it('маппит сообщения + total', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({ id: 'db1' });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      {
        id: 'm1',
        senderType: 'CLIENT',
        senderName: 'Arsenii',
        contentType: 'TEXT',
        text: 'Привет',
        imageUrl: null,
        fileUrl: null,
        audioUrl: null,
        videoUrl: null,
        externalCreatedAt: new Date('2026-06-04T10:00:00.000Z'),
        isOutboundFromKora: false,
        sessionId: 's1',
      },
    ]);
    prisma.chatboxMessage.count.mockResolvedValue(1);

    const out = await service.listMessages('t1', 'db1', {});

    expect(out.total).toBe(1);
    expect(out.items[0]).toEqual(
      expect.objectContaining({
        id: 'm1',
        senderType: 'CLIENT',
        text: 'Привет',
        isOutboundFromKora: false,
        externalCreatedAt: '2026-06-04T10:00:00.000Z',
      }),
    );
  });
});

describe('ChatboxChatsService.sendMessage', () => {
  it('успех → client.sendMessage + upsert(isOutboundFromKora) + chat.update', async () => {
    const { service, prisma, client, integration } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      lastMessageAt: new Date('2026-06-04T09:00:00.000Z'),
    });
    integration.getConfigForSync.mockResolvedValue({
      workspaceId: 'ws1',
      token: 'tok',
      integrationId: 'int1',
    });
    client.sendMessage.mockResolvedValue({
      id: 'apiMsg1',
      content: { type: 'TEXT', text: 'Ответ' },
      sender: { id: 'sndr1', name: 'Менеджер', type: 'USER' },
      createdAt: '2026-06-04T10:00:00.000Z',
    });
    prisma.chatboxMessage.findUnique.mockResolvedValue(null);
    prisma.chatboxMessage.upsert.mockResolvedValue({});
    prisma.chatboxChat.update.mockResolvedValue({});

    const out = await service.sendMessage('t1', 'db1', 'Ответ');

    expect(out).toEqual({ id: 'apiMsg1' });
    expect(client.sendMessage).toHaveBeenCalledWith('tok', 'ws1', 'ext1', {
      text: 'Ответ',
    });
    expect(prisma.chatboxMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_externalId: { tenantId: 't1', externalId: 'apiMsg1' } },
        create: expect.objectContaining({
          senderType: 'USER',
          isOutboundFromKora: true,
          text: 'Ответ',
          chatId: 'db1',
          externalId: 'apiMsg1',
        }),
      }),
    );
    expect(prisma.chatboxChat.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'db1' },
        data: expect.objectContaining({
          messageCount: { increment: 1 },
          lastMessageAt: new Date('2026-06-04T10:00:00.000Z'),
        }),
      }),
    );
  });

  it('сообщение уже записано (гонка с синком) → messageCount НЕ инкрементим', async () => {
    const { service, prisma, client, integration } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      lastMessageAt: new Date('2026-06-04T09:00:00.000Z'),
    });
    integration.getConfigForSync.mockResolvedValue({
      workspaceId: 'ws1',
      token: 'tok',
      integrationId: 'int1',
    });
    client.sendMessage.mockResolvedValue({
      id: 'apiMsg1',
      content: { type: 'TEXT', text: 'Ответ' },
      sender: { id: 'sndr1', name: 'Менеджер', type: 'USER' },
      createdAt: '2026-06-04T10:00:00.000Z',
    });
    // строка уже существует — upsert пойдёт по update
    prisma.chatboxMessage.findUnique.mockResolvedValue({ id: 'existing' });
    prisma.chatboxMessage.upsert.mockResolvedValue({});
    prisma.chatboxChat.update.mockResolvedValue({});

    const out = await service.sendMessage('t1', 'db1', 'Ответ');

    expect(out).toEqual({ id: 'apiMsg1' });
    const updateArg = prisma.chatboxChat.update.mock.calls[0]![0];
    expect(updateArg.data.messageCount).toBeUndefined();
    expect(updateArg.data.lastMessageAt).toEqual(
      new Date('2026-06-04T10:00:00.000Z'),
    );
  });

  it('client бросает → chatbox_send_failed, БД не трогаем', async () => {
    const { service, prisma, client, integration } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      lastMessageAt: null,
    });
    integration.getConfigForSync.mockResolvedValue({
      workspaceId: 'ws1',
      token: 'tok',
      integrationId: 'int1',
    });
    client.sendMessage.mockRejectedValue(new Error('network down'));

    await expect(service.sendMessage('t1', 'db1', 'Ответ')).rejects.toMatchObject(
      { response: { error: { code: 'chatbox_send_failed' } } },
    );
    expect(prisma.chatboxMessage.upsert).not.toHaveBeenCalled();
    expect(prisma.chatboxChat.update).not.toHaveBeenCalled();
  });

  it('нет интеграции → chatbox_not_configured', async () => {
    const { service, prisma, client, integration } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      lastMessageAt: null,
    });
    integration.getConfigForSync.mockResolvedValue(null);

    await expect(service.sendMessage('t1', 'db1', 'Ответ')).rejects.toMatchObject(
      { response: { error: { code: 'chatbox_not_configured' } } },
    );
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(prisma.chatboxMessage.upsert).not.toHaveBeenCalled();
  });

  it('нет чата → chatbox_chat_not_found (до интеграции)', async () => {
    const { service, prisma, integration } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue(null);

    await expect(service.sendMessage('t1', 'nope', 'x')).rejects.toMatchObject({
      response: { error: { code: 'chatbox_chat_not_found' } },
    });
    expect(integration.getConfigForSync).not.toHaveBeenCalled();
  });
});
