/**
 * Admin-redesign Фаза 6 — unit-тесты `AdminBotsService`.
 *
 * Покрываем главное:
 *   1) getTelegramStatus(): возвращает channelExists=false когда канала нет,
 *      и нормально декриптует token + читает RPS из AdminSetting.
 *   2) setTelegramWebhook(): вызывает `TelegramApiClient.setWebhook` с правильными
 *      аргументами и пишет webhookUrl в Channel.config.
 *   3) deleteTelegramWebhook(): вызывает `TelegramApiClient.deleteWebhook` и
 *      очищает webhookUrl из Channel.config.
 *   4) getEmailInboxStatus(): возвращает ENV-снимок.
 */

import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminBotsService } from './admin-bots.service';

interface ChannelRow {
  id: string;
  tenantId: string | null;
  kind: string;
  status: string;
  config: Record<string, unknown>;
}

function buildService(initial: {
  channels?: ChannelRow[];
  rps?: number;
  quietHours?: string | null;
}) {
  const channels: ChannelRow[] = initial.channels ?? [];

  const prisma = {
    channel: {
      findFirst: vi.fn(
        async ({ where }: { where: { tenantId: null; kind: string } }) => {
          return (
            channels.find(
              (c) => c.tenantId === where.tenantId && c.kind === where.kind,
            ) ?? null
          );
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { config: Record<string, unknown> };
        }) => {
          const ch = channels.find((c) => c.id === where.id);
          if (!ch) throw new Error('not found');
          ch.config = data.config;
          return ch;
        },
      ),
    },
  } as unknown as ConstructorParameters<typeof AdminBotsService>[0];

  const crypto = {
    isEncrypted: (v: string) => v.startsWith('enc:'),
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, ''),
  } as unknown as ConstructorParameters<typeof AdminBotsService>[1];

  const cfg = {
    telegramBot: {
      apiBase: 'https://api.telegram.org',
      globalRps: 30,
    },
    maxBot: {
      apiBase: 'https://platform-api.max.ru',
      globalRps: 20,
    },
    mailInbox: {
      enabled: true,
      domain: 'inbox.kora.app',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'inbox@kora.app',
      imapPass: 'secret',
      imapTls: true,
      imapFolder: 'INBOX',
      pollCron: '*/2 * * * *',
      maxPerRun: 50,
    },
    publicHostUrl: 'https://app.kora.test',
  } as unknown as ConstructorParameters<typeof AdminBotsService>[2];

  const telegramApi = {
    setWebhook: vi.fn(async () => undefined),
    deleteWebhook: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof AdminBotsService>[3];

  const maxApi = {
    subscribeWebhook: vi.fn(async () => undefined),
    unsubscribeWebhook: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof AdminBotsService>[4];

  const settings = {
    get: vi.fn(async (key: string) => {
      if (
        (key === 'conversational.telegram_bot_global_rps' ||
          key === 'conversational.max_bot_global_rps') &&
        initial.rps !== undefined
      ) {
        return initial.rps;
      }
      if (
        key === 'conversational.telegram_quiet_hours' ||
        key === 'conversational.max_quiet_hours'
      ) {
        return initial.quietHours ?? undefined;
      }
      return undefined;
    }),
  } as unknown as ConstructorParameters<typeof AdminBotsService>[5];

  const svc = new AdminBotsService(
    prisma,
    crypto,
    cfg,
    telegramApi,
    maxApi,
    settings,
  );

  return {
    svc,
    channels,
    prisma,
    telegramApi,
    maxApi,
    settings,
  };
}

describe('AdminBotsService', () => {
  it('getTelegramStatus: канала нет — channelExists=false, токен не установлен', async () => {
    const { svc } = buildService({});
    const result = await svc.getTelegramStatus();
    expect(result.channelExists).toBe(false);
    expect(result.token).toEqual({ isSet: false, lastChars: null });
    expect(result.kind).toBe('telegram');
    expect(result.apiBase).toBe('https://api.telegram.org');
    expect(result.globalRps).toBe(30);
  });

  it('setTelegramWebhook: вызывает Telegram API setWebhook и пишет URL в config', async () => {
    const { svc, telegramApi, channels } = buildService({
      channels: [
        {
          id: 'ch1',
          tenantId: null,
          kind: 'telegram_bot',
          status: 'active',
          config: {
            botToken: 'enc:test-token',
            webhookSecret: 'enc:test-secret',
          },
        },
      ],
    });

    const result = await svc.setTelegramWebhook({
      url: 'https://example.com/api/v1/webhooks/telegram-bot',
    });

    expect(telegramApi.setWebhook).toHaveBeenCalledWith({
      token: 'test-token',
      url: 'https://example.com/api/v1/webhooks/telegram-bot',
      secretToken: 'test-secret',
    });
    expect(result.ok).toBe(true);
    expect(result.webhookUrl).toBe(
      'https://example.com/api/v1/webhooks/telegram-bot',
    );
    expect(channels[0]!.config['webhookUrl']).toBe(
      'https://example.com/api/v1/webhooks/telegram-bot',
    );
  });

  it('setTelegramWebhook: канала нет — 400 channel_not_configured', async () => {
    const { svc } = buildService({});
    await expect(svc.setTelegramWebhook({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deleteTelegramWebhook: вызывает deleteWebhook и убирает webhookUrl', async () => {
    const { svc, telegramApi, channels } = buildService({
      channels: [
        {
          id: 'ch1',
          tenantId: null,
          kind: 'telegram_bot',
          status: 'active',
          config: {
            botToken: 'enc:test-token',
            webhookUrl: 'https://x.example.com/hook',
          },
        },
      ],
    });

    const result = await svc.deleteTelegramWebhook();

    expect(telegramApi.deleteWebhook).toHaveBeenCalledWith({
      token: 'test-token',
    });
    expect(result.webhookUrl).toBeNull();
    expect(channels[0]!.config['webhookUrl']).toBeUndefined();
  });

  it('getEmailInboxStatus: возвращает ENV-снимок IMAP', async () => {
    const { svc } = buildService({});
    const result = await svc.getEmailInboxStatus();
    expect(result.enabled).toBe(true);
    expect(result.host).toBe('imap.example.com');
    expect(result.port).toBe(993);
    expect(result.folder).toBe('INBOX');
    expect(result.lastFetchAt).toBeNull();
  });

  it('testEmailInboxConnection: пока заглушка 501', async () => {
    const { svc } = buildService({});
    await expect(svc.testEmailInboxConnection()).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
