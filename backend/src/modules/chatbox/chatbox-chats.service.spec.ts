import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import type { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxChatsService, extractChatboxOutboundId } from './chatbox-chats.service';
import type { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

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
    $queryRaw: vi.fn().mockResolvedValue([]),
    chatboxChat: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    chatboxMessage: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    chatboxCustomer: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    chatboxMember: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    chatboxChannelClient: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    chatboxChannel: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    chatboxChatSession: { findMany: vi.fn().mockResolvedValue([]) },
    ...over.prisma,
  };
  const client = { sendMessage: vi.fn(), ...over.client };
  const integration = { getConfigForSync: vi.fn(), ...over.integration };
  const analyzeQueue = {
    enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }),
  };
  const service = new ChatboxChatsService(
    prisma as unknown as PrismaService,
    client as unknown as ChatboxApiClient,
    integration as unknown as ChatboxIntegrationService,
    analyzeQueue as unknown as ChatboxAnalyzeQueueService,
  );
  return { service, prisma, client, integration };
}

describe('ChatboxChatsService.listChats', () => {
  it('схлопывает диалог-группу в 1 представителя, агрегирует messageCount/isGroup и резолвит имена/title', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'db1',
          externalId: 'ext1',
          channelExternalId: 'ch1',
          channelType: 'TELEGRAM',
          clientExternalId: 'cli1',
          customerExternalId: 'cust1',
          responsibleExternalId: 'mem1',
          title: 'Никита Емельянов',
          status: 'active',
          externalCreatedAt: new Date('2026-06-01T08:00:00.000Z'),
          group_message_count: 13n,
          group_is_group: false,
          group_last_msg: new Date('2026-06-24T10:59:42.301Z'),
        },
      ])
      .mockResolvedValueOnce([{ count: 1n }]);
    prisma.chatboxCustomer.findMany.mockResolvedValue([{ externalId: 'cust1', name: 'Arsenii' }]);
    prisma.chatboxMember.findMany.mockResolvedValue([{ externalId: 'mem1', name: 'Никита' }]);
    prisma.chatboxChannelClient.findMany.mockResolvedValue([
      { externalId: 'cli1', name: 'tg-Arsenii' },
    ]);

    const out = await service.listChats('t1', {});

    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual(
      expect.objectContaining({
        id: 'db1',
        externalId: 'ext1',
        title: 'Никита Емельянов',
        isGroup: false,
        customer: { externalId: 'cust1', name: 'Arsenii' },
        clientName: 'tg-Arsenii',
        responsible: { externalId: 'mem1', name: 'Никита' },
        lastMessageAt: '2026-06-24T10:59:42.301Z',
        messageCount: 13,
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.chatboxCustomer.findMany).toHaveBeenCalledTimes(1);
  });

  it('пустая группировка → пустой список, total 0', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);

    const out = await service.listChats('t1', {
      status: 'closed',
      channelType: 'TELEGRAM',
      customerExternalId: 'cust9',
    });

    expect(out.items).toEqual([]);
    expect(out.total).toBe(0);
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

  it('агрегирует sessions/messageCount по sibling-чатам диалога + title + messengerIdentities', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      channelExternalId: 'ch1',
      channelType: 'TELEGRAM',
      status: 'active',
      isGroup: false,
      title: 'Никита Емельянов',
      customerExternalId: 'cust1',
      clientExternalId: 'cli1',
      responsibleExternalId: 'mem1',
      lastMessageAt: new Date('2026-06-04T10:00:00.000Z'),
      messageCount: 5,
      externalCreatedAt: new Date('2026-06-01T08:00:00.000Z'),
      externalUpdatedAt: new Date('2026-06-04T10:00:00.000Z'),
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 'db1' }, { id: 'db2' }]);
    prisma.chatboxChat.findMany.mockResolvedValue([{ messageCount: 5 }, { messageCount: 8 }]);
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
        id: 's2',
        startedAt: new Date('2026-06-01T08:00:00.000Z'),
        endedAt: new Date('2026-06-02T08:00:00.000Z'),
        summary: 'итог-1',
        analysisStatus: 'done',
        previousSessionId: null,
      },
      {
        id: 's1',
        startedAt: new Date('2026-06-10T08:00:00.000Z'),
        endedAt: new Date('2026-06-11T08:00:00.000Z'),
        summary: 'итог-2',
        analysisStatus: 'done',
        previousSessionId: null,
      },
    ]);
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
    expect(out.title).toBe('Никита Емельянов');
    expect(out.isGroup).toBe(false);
    expect(out.messageCount).toBe(13);
    expect(out.participants).toEqual([]);
    expect(out.customer).toEqual({ externalId: 'cust1', name: 'Arsenii' });
    expect(out.responsible).toEqual({ externalId: 'mem1', name: 'Никита' });
    expect(out.clientName).toBe('tg-Arsenii');
    expect(out.sessions).toHaveLength(2);
    expect(out.sessions[0]).toEqual(expect.objectContaining({ id: 's2', seq: 1, summary: 'итог-1' }));
    expect(out.sessions[1]).toEqual(expect.objectContaining({ id: 's1', seq: 2, summary: 'итог-2' }));
    expect(prisma.chatboxChatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', chatId: { in: ['db1', 'db2'] } },
      }),
    );
    expect(out.messengerIdentities).toHaveLength(2);
    expect(out.messengerIdentities[0]).toEqual({
      channelType: 'TELEGRAM',
      externalId: 'cli1',
      name: 'tg-Arsenii',
      avatarUrl: 'http://a/1.png',
    });
  });

  it('групповой чат → participants из groupBy с именами из зеркал, ролями и счётчиками', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({
      id: 'db1',
      externalId: 'ext1',
      channelExternalId: 'ch1',
      channelType: 'TELEGRAM',
      status: 'active',
      isGroup: true,
      title: 'Gonka | Devs',
      customerExternalId: null,
      clientExternalId: null,
      responsibleExternalId: null,
      lastMessageAt: null,
      messageCount: 6,
      externalCreatedAt: null,
      externalUpdatedAt: null,
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 'db1' }]);
    prisma.chatboxChat.findMany.mockResolvedValue([{ messageCount: 6 }]);
    prisma.chatboxChatSession.findMany.mockResolvedValue([]);
    prisma.chatboxMessage.groupBy.mockResolvedValue([
      { senderExternalId: 'cli1', senderType: 'CLIENT', _count: { _all: 4 } },
      { senderExternalId: 'cli2', senderType: 'CLIENT', _count: { _all: 1 } },
      { senderExternalId: 'mem1', senderType: 'USER', _count: { _all: 2 } },
      { senderExternalId: 'a1', senderType: 'ASSISTANT', _count: { _all: 3 } },
    ]);
    prisma.chatboxChannelClient.findMany.mockResolvedValue([
      { externalId: 'cli1', name: 'Клиент Один' },
      { externalId: 'cli2', name: 'Клиент Два' },
    ]);
    prisma.chatboxMember.findMany.mockResolvedValue([{ externalId: 'mem1', name: 'Менеджер' }]);

    const out = await service.getChat('t1', 'db1');

    expect(out.isGroup).toBe(true);
    expect(out.title).toBe('Gonka | Devs');
    expect(out.participants).toEqual([
      { externalId: 'cli1', role: 'client', name: 'Клиент Один', messageCount: 4 },
      { externalId: 'a1', role: 'assistant', name: null, messageCount: 3 },
      { externalId: 'mem1', role: 'manager', name: 'Менеджер', messageCount: 2 },
      { externalId: 'cli2', role: 'client', name: 'Клиент Два', messageCount: 1 },
    ]);
    expect(prisma.chatboxMessage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['senderExternalId', 'senderType'],
        where: expect.objectContaining({
          tenantId: 't1',
          chatId: { in: ['db1'] },
          senderExternalId: { not: null },
        }),
      }),
    );
  });
});

describe('ChatboxChatsService.listMessages', () => {
  it('нет чата → chatbox_chat_not_found', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue(null);

    await expect(service.listMessages('t1', 'nope', {})).rejects.toMatchObject({
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

  it('senderName резолвится из зеркал по senderExternalId (client/member/assistant)', async () => {
    const { service, prisma } = makeService();
    prisma.chatboxChat.findFirst.mockResolvedValue({ id: 'db1' });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      {
        id: 'm1',
        externalId: 'e1',
        senderType: 'CLIENT',
        senderExternalId: 'cli1',
        senderName: null,
        contentType: 'TEXT',
        text: 'Привет',
        imageUrl: null,
        fileUrl: null,
        audioUrl: null,
        videoUrl: null,
        externalCreatedAt: new Date('2026-06-04T10:00:00.000Z'),
        isOutboundFromKora: false,
        sessionId: null,
      },
      {
        id: 'm2',
        externalId: 'e2',
        senderType: 'USER',
        senderExternalId: 'mem1',
        senderName: null,
        contentType: 'TEXT',
        text: 'Здравствуйте',
        imageUrl: null,
        fileUrl: null,
        audioUrl: null,
        videoUrl: null,
        externalCreatedAt: new Date('2026-06-04T10:01:00.000Z'),
        isOutboundFromKora: false,
        sessionId: null,
      },
      {
        id: 'm3',
        externalId: 'e3',
        senderType: 'ASSISTANT',
        senderExternalId: null,
        senderName: null,
        contentType: 'TEXT',
        text: 'Чем помочь?',
        imageUrl: null,
        fileUrl: null,
        audioUrl: null,
        videoUrl: null,
        externalCreatedAt: new Date('2026-06-04T10:02:00.000Z'),
        isOutboundFromKora: true,
        sessionId: null,
      },
    ]);
    prisma.chatboxMessage.count.mockResolvedValue(3);
    prisma.chatboxChannelClient.findMany.mockResolvedValue([
      { externalId: 'cli1', name: 'Клиент Имя' },
    ]);
    prisma.chatboxMember.findMany.mockResolvedValue([{ externalId: 'mem1', name: 'Менеджер Имя' }]);

    const out = await service.listMessages('t1', 'db1', {});

    expect(out.items[0]).toEqual(expect.objectContaining({ id: 'm1', senderName: 'Клиент Имя' }));
    expect(out.items[1]).toEqual(expect.objectContaining({ id: 'm2', senderName: 'Менеджер Имя' }));
    expect(out.items[2]).toEqual(expect.objectContaining({ id: 'm3', senderName: 'Ассистент' }));
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
    prisma.chatboxMessage.findUnique.mockResolvedValue({ id: 'existing' });
    prisma.chatboxMessage.upsert.mockResolvedValue({});
    prisma.chatboxChat.update.mockResolvedValue({});

    const out = await service.sendMessage('t1', 'db1', 'Ответ');

    expect(out).toEqual({ id: 'apiMsg1' });
    const updateArg = prisma.chatboxChat.update.mock.calls[0]![0];
    expect(updateArg.data.messageCount).toBeUndefined();
    expect(updateArg.data.lastMessageAt).toEqual(new Date('2026-06-04T10:00:00.000Z'));
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

    await expect(service.sendMessage('t1', 'db1', 'Ответ')).rejects.toMatchObject({
      response: { error: { code: 'chatbox_send_failed' } },
    });
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

    await expect(service.sendMessage('t1', 'db1', 'Ответ')).rejects.toMatchObject({
      response: { error: { code: 'chatbox_not_configured' } },
    });
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

describe('extractChatboxOutboundId (чистый хелпер)', () => {
  it('плоский { id }', () => {
    expect(extractChatboxOutboundId({ id: 'x' })).toEqual({
      id: 'x',
      createdAt: null,
      senderId: null,
      senderName: null,
    });
  });

  it('вложенный message.messageId', () => {
    expect(extractChatboxOutboundId({ message: { messageId: 'y' } })).toEqual({
      id: 'y',
      createdAt: null,
      senderId: null,
      senderName: null,
    });
  });

  it('вложенный data.external_id числом → String()', () => {
    expect(extractChatboxOutboundId({ data: { external_id: 7 } })).toEqual({
      id: '7',
      createdAt: null,
      senderId: null,
      senderName: null,
    });
  });

  it('обёртка result с приоритетом id-ключей', () => {
    expect(extractChatboxOutboundId({ result: { _id: 'z', text: 'привет' } })).toEqual({
      id: 'z',
      createdAt: null,
      senderId: null,
      senderName: null,
    });
  });

  it('форма ответа без id-ключей → id=null (синтетический ключ выберет вызывающий)', () => {
    expect(extractChatboxOutboundId({ foo: 1 })).toEqual({
      id: null,
      createdAt: null,
      senderId: null,
      senderName: null,
    });
  });

  it('createdAt и sender (id+name) из вложенной обёртки', () => {
    expect(
      extractChatboxOutboundId({
        message: {
          id: 'm1',
          created_at: '2026-06-11T10:00:00.000Z',
          sender: { id: 'u1', name: 'Менеджер' },
        },
      }),
    ).toEqual({
      id: 'm1',
      createdAt: '2026-06-11T10:00:00.000Z',
      senderId: 'u1',
      senderName: 'Менеджер',
    });
  });

  it('sender как from.{id,name} (альтернативное имя)', () => {
    expect(extractChatboxOutboundId({ id: 'm2', from: { id: 'f1', name: 'Бот' } })).toEqual({
      id: 'm2',
      createdAt: null,
      senderId: 'f1',
      senderName: 'Бот',
    });
  });

  it('некорректный raw (null/строка/число) → все поля null', () => {
    for (const bad of [null, undefined, 'str', 42]) {
      expect(extractChatboxOutboundId(bad)).toEqual({
        id: null,
        createdAt: null,
        senderId: null,
        senderName: null,
      });
    }
  });
});
