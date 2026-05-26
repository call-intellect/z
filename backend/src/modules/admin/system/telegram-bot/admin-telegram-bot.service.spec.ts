import type { Channel } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { TelegramApiClient } from '../../../conversational/adapters/telegram-bot/telegram-api-client';
import type {
  TelegramProxyAdminClient,
  TelegramProxyBotInfo,
} from '../../../conversational/adapters/telegram-bot/telegram-proxy-admin.client';
import { TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC } from '../../../conversational/topics';

import { AdminTelegramBotService } from './admin-telegram-bot.service';

/**
 * Unit-тесты AdminTelegramBotService (β-9 Phase 4).
 *
 * Покрываем:
 *   - getSettings: токен НЕ возвращается в plain, только tokenLastChars;
 *   - getSettings: пустой канал отдаёт безопасные дефолты;
 *   - updateToken: вызывает getMe (валидация), encrypt, upsert;
 *   - setStatus: меняет channel.status;
 *   - updateTemplates: мерджит, не теряет соседние ключи.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function makeMockServices(): {
  prisma: PrismaService;
  crypto: CryptoService;
  cfg: TypedConfigService;
  tgApi: TelegramApiClient;
  proxyAdmin: TelegramProxyAdminClient;
  metrics: BusinessMetricsService;
  redis: RedisService;
  prismaSpies: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
    notificationDeliveryCount: ReturnType<typeof vi.fn>;
    notificationCount: ReturnType<typeof vi.fn>;
    notificationFindFirst: ReturnType<typeof vi.fn>;
  };
  cryptoSpies: {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
    isEncrypted: ReturnType<typeof vi.fn>;
  };
  tgSpies: {
    getMe: ReturnType<typeof vi.fn>;
    setWebhook: ReturnType<typeof vi.fn>;
  };
  proxySpies: {
    upsertBot: ReturnType<typeof vi.fn>;
  };
  redisSpies: {
    publish: ReturnType<typeof vi.fn>;
  };
  metricsSpy: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn();
  const update = vi.fn();
  const create = vi.fn();
  const count = vi.fn();
  const findMany = vi.fn();
  const transaction = vi.fn();
  const notificationDeliveryCount = vi.fn();
  const notificationCount = vi.fn();
  const notificationFindFirst = vi.fn();

  const prisma = {
    channel: { findFirst, update, create },
    channelBinding: { count, findMany },
    notificationDelivery: { count: notificationDeliveryCount },
    notification: {
      count: notificationCount,
      findFirst: notificationFindFirst,
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  const encrypt = vi.fn((v: string) => `gcm:v1:enc(${v})`);
  const decrypt = vi.fn((v: string) =>
    v.startsWith('gcm:v1:enc(') ? v.replace(/^gcm:v1:enc\(/, '').slice(0, -1) : v,
  );
  const isEncrypted = vi.fn((v: string) => v.startsWith('gcm:v1:'));
  const crypto = {
    encrypt,
    decrypt,
    isEncrypted,
  } as unknown as CryptoService;

  const cfg = {
    publicHostUrl: 'https://app.example.org',
    // По умолчанию в тестах прокси выключен — это сохраняет старое
    // поведение (legacy setWebhook) и не требует обновления уже
    // существующих тестов. Тесты Фазы 3 переключают enabled=true явно.
    telegramProxy: { enabled: false } as { enabled: boolean },
  } as unknown as TypedConfigService;

  const getMe = vi.fn(async () => ({
    id: 1234,
    username: 'kora_bot',
    first_name: 'Kora',
  }));
  const setWebhook = vi.fn(async () => undefined);
  const tgApi = { getMe, setWebhook } as unknown as TelegramApiClient;

  const upsertBot = vi.fn(
    async (_args: {
      token: string;
      secretToken: string;
      targetUrl: string;
    }): Promise<TelegramProxyBotInfo> => ({ id: 'proxy-bot-1' }),
  );
  const proxyAdmin = { upsertBot } as unknown as TelegramProxyAdminClient;

  const metricsSpy = vi.fn();
  const metrics = {
    incAdminTelegramBotAction: metricsSpy,
  } as unknown as BusinessMetricsService;

  const publish = vi.fn(async () => 1);
  const redis = {
    client: { publish },
  } as unknown as RedisService;

  return {
    prisma,
    crypto,
    cfg,
    tgApi,
    proxyAdmin,
    metrics,
    redis,
    prismaSpies: {
      findFirst,
      update,
      create,
      count,
      findMany,
      transaction,
      notificationDeliveryCount,
      notificationCount,
      notificationFindFirst,
    },
    cryptoSpies: { encrypt, decrypt, isEncrypted },
    tgSpies: { getMe, setWebhook },
    proxySpies: { upsertBot },
    redisSpies: { publish },
    metricsSpy,
  };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  const now = new Date('2026-05-25T10:00:00Z');
  return {
    id: 'ch-1',
    tenantId: null,
    kind: 'telegram_bot',
    direction: 'bidirectional',
    config: {},
    status: 'active',
    maxDataClass: 'internal',
    brokenReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Channel;
}

describe('AdminTelegramBotService', () => {
  let m: ReturnType<typeof makeMockServices>;
  let svc: AdminTelegramBotService;

  beforeEach(() => {
    m = makeMockServices();
    svc = new AdminTelegramBotService(
      m.prisma,
      m.crypto,
      m.cfg,
      m.tgApi,
      m.proxyAdmin,
      m.metrics,
      m.redis,
    );
  });

  describe('getSettings', () => {
    it('канал не существует — channelExists=false и дефолтные шаблоны', async () => {
      m.prismaSpies.findFirst.mockResolvedValue(null);
      const r = await svc.getSettings();
      expect(r.channelExists).toBe(false);
      expect(r.tokenIsSet).toBe(false);
      expect(r.tokenLastChars).toBeNull();
      expect(r.webhookUrl).toBe(
        'https://app.example.org/api/v1/webhooks/telegram-bot',
      );
      expect(r.status).toBe('disabled');
      expect(r.templates.welcome).toContain('Готово');
      expect(m.metricsSpy).toHaveBeenCalledWith({ action: 'settings_read' });
    });

    it('канал с токеном — никогда не возвращает токен в plain, только tokenLastChars', async () => {
      const tokenPlain = '123456789:ABCdef1234567890XYZ';
      m.prismaSpies.findFirst.mockResolvedValue(
        makeChannel({
          config: {
            botToken: `gcm:v1:enc(${tokenPlain})`,
            webhookSecret: `gcm:v1:enc(secret123)`,
            botUsername: 'kora_bot',
            templates: { welcome: 'Привет, друг!' },
          } as never,
        }),
      );
      const r = await svc.getSettings();
      expect(r.tokenIsSet).toBe(true);
      expect(r.tokenLastChars).toBe('****0XYZ');
      // Никакой строки полного токена в ответе быть не должно.
      const flat = JSON.stringify(r);
      expect(flat).not.toContain(tokenPlain);
      expect(flat).not.toContain('123456789:ABCdef');
      expect(r.botUsername).toBe('kora_bot');
      expect(r.templates.welcome).toBe('Привет, друг!');
      expect(r.templates.notLinked).toContain('Вы не привязаны');
    });
  });

  describe('updateToken', () => {
    it('валидный токен → encrypt + create channel + получаем botUsername', async () => {
      m.prismaSpies.findFirst.mockResolvedValue(null);
      m.prismaSpies.create.mockResolvedValue(
        makeChannel({
          id: 'ch-new',
          config: {
            botToken: 'gcm:v1:enc(123456789:secret-abc)',
            botUsername: 'kora_bot',
          } as never,
        }),
      );
      // После create — для getSettings() — снова findFirst.
      m.prismaSpies.findFirst
        .mockResolvedValueOnce(null) // upsert lookup
        .mockResolvedValueOnce(
          makeChannel({
            config: {
              botToken: 'gcm:v1:enc(123456789:secret-abc)',
              botUsername: 'kora_bot',
            } as never,
          }),
        );

      const r = await svc.updateToken({ token: '123456789:secret-abc' });

      expect(m.tgSpies.getMe).toHaveBeenCalledWith({
        token: '123456789:secret-abc',
      });
      expect(m.cryptoSpies.encrypt).toHaveBeenCalledWith(
        '123456789:secret-abc',
      );
      expect(m.prismaSpies.create).toHaveBeenCalledOnce();
      const createArg = m.prismaSpies.create.mock.calls[0]?.[0] as {
        data: { config: Record<string, unknown> };
      };
      expect(createArg.data.config['botToken']).toBe(
        'gcm:v1:enc(123456789:secret-abc)',
      );
      expect(createArg.data.config['botUsername']).toBe('kora_bot');
      expect(m.metricsSpy).toHaveBeenCalledWith({ action: 'token_changed' });
      expect(r.tokenIsSet).toBe(true);
    });

    it('Telegram отверг getMe → BadRequest, БД не трогается', async () => {
      m.tgSpies.getMe.mockRejectedValue(new Error('Unauthorized'));
      try {
        await svc.updateToken({ token: '111:bad-token-xx' });
        throw new Error('expected BadRequest');
      } catch (err) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          ok: false,
          error: { code: 'telegram_token_invalid' },
        });
      }
      expect(m.cryptoSpies.encrypt).not.toHaveBeenCalled();
      expect(m.prismaSpies.create).not.toHaveBeenCalled();
      expect(m.prismaSpies.update).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('канала нет → NotFound', async () => {
      m.prismaSpies.findFirst.mockResolvedValue(null);
      try {
        await svc.setStatus({ status: 'global_disabled' });
        throw new Error('expected NotFound');
      } catch (err) {
        const response = (err as { getResponse?: () => unknown }).getResponse?.();
        expect(response).toMatchObject({
          ok: false,
          error: { code: 'channel_not_configured' },
        });
      }
    });

    it('global_disabled → channel.update со статусом global_disabled', async () => {
      m.prismaSpies.findFirst
        .mockResolvedValueOnce(makeChannel({ status: 'active' }))
        .mockResolvedValueOnce(makeChannel({ status: 'global_disabled' }));
      m.prismaSpies.update.mockResolvedValue(undefined);

      const r = await svc.setStatus({ status: 'global_disabled' });

      expect(m.prismaSpies.update).toHaveBeenCalledWith({
        where: { id: 'ch-1' },
        data: { status: 'global_disabled' },
      });
      expect(m.metricsSpy).toHaveBeenCalledWith({ action: 'status_toggled' });
      expect(r.status).toBe('global_disabled');
    });
  });

  describe('updateTemplates', () => {
    it('мержит новые поля с существующими, не теряет соседей', async () => {
      const existing = makeChannel({
        config: {
          botToken: 'gcm:v1:enc(abc)',
          templates: {
            welcome: 'Старое приветствие',
            notLinked: 'Старый текст «не привязан»',
          },
        } as never,
      });
      // Первый findFirst — для upsert; второй — для последующего getSettings.
      m.prismaSpies.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);
      const updatedConfig: Mutable<Record<string, unknown>> = {};
      m.prismaSpies.update.mockImplementation((args: {
        data: { config: Record<string, unknown> };
      }) => {
        Object.assign(updatedConfig, args.data.config);
        return Promise.resolve(makeChannel({ config: args.data.config as never }));
      });

      await svc.updateTemplates({ welcome: 'Новое приветствие' });

      expect(updatedConfig['templates']).toEqual({
        welcome: 'Новое приветствие',
        notLinked: 'Старый текст «не привязан»',
      });
      expect(updatedConfig['botToken']).toBe('gcm:v1:enc(abc)');
      expect(m.metricsSpy).toHaveBeenCalledWith({
        action: 'templates_updated',
      });
    });
  });

  describe('resetWebhook (proxy mode, 2026-05-26)', () => {
    it('proxy enabled → upsertBot, setWebhook напрямую НЕ вызывается, в config сохраняется proxyBotId', async () => {
      (m.cfg as unknown as { telegramProxy: { enabled: boolean } }).telegramProxy.enabled = true;

      const existing = makeChannel({
        config: {
          botToken: 'gcm:v1:enc(token-plain-1234)',
        } as never,
      });
      m.prismaSpies.findFirst
        .mockResolvedValueOnce(existing) // initial find в resetWebhook
        .mockResolvedValueOnce(existing) // upsertGlobalChannel.find
        .mockResolvedValueOnce(existing); // getSettings() в конце
      let savedConfig: Record<string, unknown> | null = null;
      m.prismaSpies.update.mockImplementation((args: {
        data: { config: Record<string, unknown> };
      }) => {
        savedConfig = args.data.config;
        return Promise.resolve(makeChannel({ config: args.data.config as never }));
      });

      await svc.resetWebhook();

      expect(m.proxySpies.upsertBot).toHaveBeenCalledOnce();
      const call = m.proxySpies.upsertBot.mock.calls[0]?.[0] as {
        token: string;
        secretToken: string;
        targetUrl: string;
      };
      expect(call.token).toBe('token-plain-1234');
      expect(call.targetUrl).toBe('https://app.example.org/api/v1/webhooks/telegram-bot');
      expect(call.secretToken).toMatch(/^[a-f0-9]{32}$/);
      // legacy setWebhook не вызывается.
      expect(m.tgSpies.setWebhook).not.toHaveBeenCalled();
      // в config сохранены proxyBotId / proxyRegisteredAt.
      expect(savedConfig).not.toBeNull();
      const cfg = savedConfig as unknown as Record<string, unknown>;
      expect(cfg['proxyBotId']).toBe('proxy-bot-1');
      expect(typeof cfg['proxyRegisteredAt']).toBe('string');
      expect(cfg['proxyLastSyncError']).toBeNull();
      expect(typeof cfg['webhookSecret']).toBe('string');
      expect(m.metricsSpy).toHaveBeenCalledWith({ action: 'webhook_reset' });
      // Фаза 4: pub/sub-инвалидация in-process кэша во всех нодах.
      expect(m.redisSpies.publish).toHaveBeenCalledWith(
        TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC,
        expect.stringContaining('webhook_reset'),
      );
    });

    it('proxy enabled, upsertBot падает → BadRequest, токен/секрет в БД не пишутся', async () => {
      (m.cfg as unknown as { telegramProxy: { enabled: boolean } }).telegramProxy.enabled = true;

      m.prismaSpies.findFirst.mockResolvedValue(
        makeChannel({
          config: { botToken: 'gcm:v1:enc(token-x)' } as never,
        }),
      );
      m.proxySpies.upsertBot.mockRejectedValue(new Error('proxy down'));

      const err = await svc.resetWebhook().catch((e) => e);
      const response = (err as { getResponse?: () => unknown }).getResponse?.();
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'telegram_proxy_upsert_failed' },
      });
      expect(m.prismaSpies.update).not.toHaveBeenCalled();
      expect(m.prismaSpies.create).not.toHaveBeenCalled();
      expect(m.tgSpies.setWebhook).not.toHaveBeenCalled();
    });

    it('proxy disabled (legacy) → дёргается tgApi.setWebhook, upsertBot НЕ вызывается', async () => {
      // cfg.telegramProxy.enabled = false (default makeMockServices()).
      const existing = makeChannel({
        config: {
          botToken: 'gcm:v1:enc(legacy-token-5678)',
        } as never,
      });
      m.prismaSpies.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);
      m.prismaSpies.update.mockResolvedValue(existing);

      await svc.resetWebhook();

      expect(m.tgSpies.setWebhook).toHaveBeenCalledOnce();
      expect(m.proxySpies.upsertBot).not.toHaveBeenCalled();
    });

    it('канала нет → BadRequest channel_not_configured', async () => {
      m.prismaSpies.findFirst.mockResolvedValue(null);
      const err = await svc.resetWebhook().catch((e) => e);
      const response = (err as { getResponse?: () => unknown }).getResponse?.();
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'channel_not_configured' },
      });
    });

    it('токен не задан → BadRequest token_not_set', async () => {
      m.prismaSpies.findFirst.mockResolvedValue(
        makeChannel({ config: {} as never }),
      );
      const err = await svc.resetWebhook().catch((e) => e);
      const response = (err as { getResponse?: () => unknown }).getResponse?.();
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'token_not_set' },
      });
    });
  });
});
