import type { Channel, ChannelBinding } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { ChannelRegistry } from '../../channel-registry';
import type { ConversationalLinkCodeService } from '../../link-code.service';

import type { TelegramApiClient } from './telegram-api-client';
import { TelegramBotChannelAdapter } from './telegram-bot.adapter';
import type { TelegramUpdate } from './telegram.types';

/**
 * Unit-тесты `TelegramBotChannelAdapter.ingestUpdate` — основной парсер
 * inbound Telegram Update. Покрываются ключевые сценарии:
 *   - `/link <code>` ok / fail,
 *   - `/ask <q>` → InboundMessage{type:'chat_query'},
 *   - callback_query → InboundMessage{type:'response'},
 *   - свободный текст → InboundMessage{type:'free_note'},
 *   - voice message → null + reply best-effort,
 *   - сообщение от незалинкованного пользователя → null + reply.
 *
 * Все зависимости мокаются через `vi.fn()` и cast to type — паттерн,
 * принятый в проекте (см. `hmac.service.spec.ts`).
 */

function makeChannel(): Channel {
  return {
    id: 'channel-1',
    tenantId: 'org-1',
    kind: 'telegram_bot',
    direction: 'bidirectional',
    config: {
      botToken: 'plain-token',
      webhookSecret: 'secret',
      botUsername: 'kora_test_bot',
    },
    status: 'active',
    maxDataClass: 'internal',
    brokenReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Channel;
}

function makeAdapter() {
  const registry = { register: vi.fn() } as unknown as ChannelRegistry;
  const prisma = {
    channelBinding: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    notification: {
      findUnique: vi.fn(),
    },
    notificationDelivery: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaService;

  const crypto = {
    isEncrypted: vi.fn().mockReturnValue(false),
    decrypt: vi.fn().mockImplementation((v: string) => v),
  } as unknown as CryptoService;

  const api = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 999, chatId: 100 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as TelegramApiClient;

  const linkCode = {
    consume: vi.fn(),
  } as unknown as ConversationalLinkCodeService;

  const metrics = {
    incTelegramBotWebhookReceived: vi.fn(),
    incTelegramBotApiError: vi.fn(),
  } as unknown as BusinessMetricsService;

  const adapter = new TelegramBotChannelAdapter(
    registry,
    prisma,
    crypto,
    api,
    linkCode,
    metrics,
  );
  return { adapter, registry, prisma, crypto, api, linkCode, metrics };
}

describe('TelegramBotChannelAdapter.ingestUpdate', () => {
  let mocks: ReturnType<typeof makeAdapter>;
  let channel: Channel;

  beforeEach(() => {
    mocks = makeAdapter();
    channel = makeChannel();
  });

  it('/link <code>: при валидном коде создаёт binding и шлёт приветствие', async () => {
    vi.mocked(mocks.linkCode.consume).mockResolvedValue('user-42');
    vi.mocked(mocks.prisma.channelBinding.upsert).mockResolvedValue({
      id: 'binding-1',
      userId: 'user-42',
      channelId: channel.id,
      externalId: '100',
      verifiedAt: new Date(),
    } as unknown as ChannelBinding);

    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100, username: 'user' },
        text: '/link ABCDEF123456',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.linkCode.consume).toHaveBeenCalledWith({
      kind: 'telegram_bot',
      code: 'ABCDEF123456',
    });
    expect(mocks.prisma.channelBinding.upsert).toHaveBeenCalled();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    // должно содержать «привязан»
    const callArgs = vi.mocked(mocks.api.sendMessage).mock.calls[0]![0];
    expect(callArgs.text).toContain('привязан');
  });

  it('/link <code>: при невалидном коде не создаёт binding и шлёт «код невалиден»', async () => {
    vi.mocked(mocks.linkCode.consume).mockResolvedValue(null);

    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 11,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/link BADCODE',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.prisma.channelBinding.upsert).not.toHaveBeenCalled();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/невалид|истёк/i);
  });

  it('/ask <вопрос>: для залинкованного юзера возвращает InboundMessage{type:"chat_query"}', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue({
      id: 'binding-2',
      userId: 'user-42',
      channelId: channel.id,
      externalId: '100',
      verifiedAt: new Date(),
    } as unknown as ChannelBinding);

    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 12,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/ask Какой бюджет на Q4?',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toEqual({
      type: 'chat_query',
      userId: 'user-42',
      tenantId: 'org-1',
      question: 'Какой бюджет на Q4?',
      originChannelBindingId: 'binding-2',
    });
  });

  it('свободный текст: для залинкованного юзера возвращает InboundMessage{type:"free_note"}', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue({
      id: 'binding-3',
      userId: 'user-42',
      channelId: channel.id,
      externalId: '100',
      verifiedAt: new Date(),
    } as unknown as ChannelBinding);

    const update: TelegramUpdate = {
      update_id: 4,
      message: {
        message_id: 13,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Просто заметка без команды',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toMatchObject({
      type: 'free_note',
      userId: 'user-42',
      tenantId: 'org-1',
      text: 'Просто заметка без команды',
      originChannelBindingId: 'binding-3',
    });
  });

  it('callback_query: возвращает InboundMessage{type:"response"} с notificationId из callback_data', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue({
      id: 'binding-4',
      userId: 'user-42',
      channelId: channel.id,
      externalId: '100',
      verifiedAt: new Date(),
    } as unknown as ChannelBinding);
    vi.mocked(mocks.prisma.notification.findUnique).mockResolvedValue({
      id: 'notif-1',
      payload: { question: 'Q', options: ['Да', 'Нет'] },
    } as unknown as Awaited<
      ReturnType<typeof mocks.prisma.notification.findUnique>
    >);

    const update: TelegramUpdate = {
      update_id: 5,
      callback_query: {
        id: 'cb-1',
        from: { id: 100 },
        data: 'pq:notif-1:0',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toEqual({
      type: 'response',
      userId: 'user-42',
      tenantId: 'org-1',
      notificationId: 'notif-1',
      payload: { kind: 'option', optionIndex: 0, optionText: 'Да' },
      originChannelBindingId: 'binding-4',
    });
    expect(mocks.api.answerCallbackQuery).toHaveBeenCalled();
  });

  it('voice-сообщение: игнорируется, отправляется уведомление «не поддерживается»', async () => {
    const update: TelegramUpdate = {
      update_id: 6,
      message: {
        message_id: 14,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        voice: { duration: 3 },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/голос/i);
  });

  it('сообщение от незалинкованного юзера: возвращает null и шлёт «привяжите»', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(null);

    const update: TelegramUpdate = {
      update_id: 7,
      message: {
        message_id: 15,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/ask вопрос',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/привяжите|привязан/i);
  });

  it('/status: для залинкованного юзера возвращает InboundMessage{type:"command", commandName:"status"}', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue({
      id: 'binding-5',
      userId: 'user-42',
      channelId: channel.id,
      externalId: '100',
      verifiedAt: new Date(),
    } as unknown as ChannelBinding);

    const update: TelegramUpdate = {
      update_id: 8,
      message: {
        message_id: 16,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/status',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toEqual({
      type: 'command',
      userId: 'user-42',
      tenantId: 'org-1',
      commandName: 'status',
      originChannelBindingId: 'binding-5',
    });
  });
});
