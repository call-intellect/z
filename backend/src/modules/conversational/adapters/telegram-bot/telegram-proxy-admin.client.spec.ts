import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';

import {
  TelegramProxyAdminClient,
  TelegramProxyAdminError,
} from './telegram-proxy-admin.client';

/**
 * Unit-тесты `TelegramProxyAdminClient` после перехода на статический
 * Bearer-токен (`TELEGRAM_PROXY_TOKEN`) и реальный контракт прокси
 * `telegram.crossmark.ru` (Swagger `/docs`).
 *
 * Покрываем:
 *   - getAdminToken() возвращает токен из ENV; кидает если выключен / пуст.
 *   - apiRequest() шлёт Bearer-токен; на 401 — внятная ошибка (без relogin).
 *   - upsertBot(): POST при пустом списке, PATCH при существующем боте,
 *     матчинг по telegramBotId, валидации, webhookError → throw.
 *   - ping() возвращает {ok:true} на 2xx, {ok:false} на сеть/HTTP-ошибку.
 */

const ORIGINAL_FETCH = globalThis.fetch;

function makeCfg(
  overrides: Partial<{ enabled: boolean; token: string | undefined }> = {},
): TypedConfigService {
  return {
    telegramProxy: {
      enabled: overrides.enabled ?? true,
      apiBase: 'https://proxy.test',
      fileBase: 'https://proxy.test',
      token: 'token' in overrides ? overrides.token : 'static-admin-token',
      requestTimeoutMs: 0,
      healthIntervalSec: 0,
      pingTimeoutSec: 5,
    },
  } as unknown as TypedConfigService;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('TelegramProxyAdminClient.getAdminToken', () => {
  it('возвращает статический токен из ENV', () => {
    const client = new TelegramProxyAdminClient(makeCfg());
    expect(client.getAdminToken()).toBe('static-admin-token');
  });

  it('бросает если прокси выключен', () => {
    const client = new TelegramProxyAdminClient(makeCfg({ enabled: false }));
    expect(() => client.getAdminToken()).toThrow(/TELEGRAM_PROXY_ENABLED=false/);
  });

  it('бросает если TELEGRAM_PROXY_TOKEN не задан', () => {
    const client = new TelegramProxyAdminClient(makeCfg({ token: undefined }));
    expect(() => client.getAdminToken()).toThrow(/TELEGRAM_PROXY_TOKEN не задан/);
  });
});

describe('TelegramProxyAdminClient.apiRequest', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('шлёт Authorization: Bearer <token>', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());

    await client.apiRequest('GET', '/api/bots', undefined);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://proxy.test/api/bots',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer static-admin-token',
        }),
      }),
    );
  });

  it('на 401 бросает внятную ошибку без re-login', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());

    const err = await client
      .apiRequest('GET', '/api/bots', undefined)
      .catch((e) => e);
    expect(err).toBeInstanceOf(TelegramProxyAdminError);
    expect((err as TelegramProxyAdminError).status).toBe(401);
    expect((err as TelegramProxyAdminError).message).toMatch(/TELEGRAM_PROXY_TOKEN/);
    // Только один запрос — никакого повторного логина.
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('на 5xx бросает transient-ошибку', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('upstream down', { status: 503 }),
    ) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());

    const err = await client
      .apiRequest('GET', '/api/bots', undefined)
      .catch((e) => e);
    expect((err as TelegramProxyAdminError).status).toBe(503);
    expect((err as TelegramProxyAdminError).transient).toBe(true);
  });
});

describe('TelegramProxyAdminClient.upsertBot', () => {
  it('GET /api/bots пуст → POST /api/bots (создание) с {name,token,targetWebhookUrl}', async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method, body });
      if (url.endsWith('/api/bots') && init?.method === 'GET') {
        return new Response(JSON.stringify({ total: 0, items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/bots') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'bot-new-1',
            name: 'Kora',
            telegramBotId: 111,
            tokenPreview: '111:******cdef',
            webhookUrl: 'https://proxy.test/webhook/abc',
            targetWebhookUrl: 'https://app.example/api/v1/webhooks/telegram-bot/s/sec1',
            isActive: true,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new TelegramProxyAdminClient(makeCfg());
    const info = await client.upsertBot({
      name: 'Kora',
      token: '111:abcdef',
      targetUrl: 'https://app.example/api/v1/webhooks/telegram-bot/s/sec1',
    });

    expect(info.id).toBe('bot-new-1');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.body).toEqual({
      name: 'Kora',
      token: '111:abcdef',
      targetWebhookUrl: 'https://app.example/api/v1/webhooks/telegram-bot/s/sec1',
    });
  });

  it('GET возвращает существующего (match по telegramBotId) → PATCH /api/bots/:id', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith('/api/bots') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            total: 2,
            items: [
              { id: 'other', telegramBotId: 999, tokenPreview: '999:******zzzz', webhookUrl: 'x', targetWebhookUrl: 'y', name: 'Other', isActive: true },
              { id: 'bot-existing-9', telegramBotId: 111, tokenPreview: '111:******cdef', webhookUrl: 'x', targetWebhookUrl: 'y', name: 'Kora', isActive: true },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/bots/bot-existing-9') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            id: 'bot-existing-9',
            name: 'Kora',
            telegramBotId: 111,
            tokenPreview: '111:******cdef',
            webhookUrl: 'x',
            targetWebhookUrl: 'y',
            isActive: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    const client = new TelegramProxyAdminClient(makeCfg());
    const info = await client.upsertBot({
      name: 'Kora',
      token: '111:abcdef',
      targetUrl: 'https://app/api/v1/webhooks/telegram-bot/s/sec',
    });
    expect(info.id).toBe('bot-existing-9');
    expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/api/bots/bot-existing-9'))).toBe(true);
  });

  it('webhookError в ответе → бросает (прокси не смог setWebhook)', async () => {
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/bots') && init?.method === 'GET') {
        return new Response(JSON.stringify({ total: 0, items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'bot-x',
          name: 'Kora',
          tokenPreview: '111:******cdef',
          webhookUrl: 'x',
          targetWebhookUrl: 'y',
          isActive: false,
          webhookError: 'Unauthorized: invalid token',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const client = new TelegramProxyAdminClient(makeCfg());
    await expect(
      client.upsertBot({
        name: 'Kora',
        token: '111:abcdef',
        targetUrl: 'https://app/webhook/s/sec',
      }),
    ).rejects.toThrow(/webhook/i);
  });

  it('targetUrl без https:// → бросает', async () => {
    const client = new TelegramProxyAdminClient(makeCfg());
    await expect(
      client.upsertBot({ name: 'x', token: 't', targetUrl: 'http://insecure/s/sec' }),
    ).rejects.toThrow(/https:\/\//);
  });

  it('пустой token → бросает', async () => {
    const client = new TelegramProxyAdminClient(makeCfg());
    await expect(
      client.upsertBot({ name: 'x', token: '', targetUrl: 'https://x/s/y' }),
    ).rejects.toThrow(/token/);
  });

  it('пустой name → бросает', async () => {
    const client = new TelegramProxyAdminClient(makeCfg());
    await expect(
      client.upsertBot({ name: '', token: 't', targetUrl: 'https://x/s/y' }),
    ).rejects.toThrow(/name/);
  });
});

describe('TelegramProxyAdminClient.getBotByToken', () => {
  it('botId есть в списке → возвращает по telegramBotId', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          total: 1,
          items: [
            { id: 'b1', telegramBotId: 111, tokenPreview: '111:******cdef', webhookUrl: 'x', targetWebhookUrl: 'y', name: 'Kora', isActive: true },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());
    const info = await client.getBotByToken('111:abcdef');
    expect(info?.id).toBe('b1');
  });

  it('botId НЕ найден среди ботов → null (не берём чужого)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          total: 1,
          items: [
            { id: 'b1', telegramBotId: 999, tokenPreview: '999:******zzzz', webhookUrl: 'x', targetWebhookUrl: 'y', name: 'Other', isActive: true },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());
    const info = await client.getBotByToken('111:abcdef');
    expect(info).toBeNull();
  });
});

describe('TelegramProxyAdminClient.ping', () => {
  it('возвращает ok:true на 200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());
    const r = await client.ping();
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });

  it('возвращает ok:false при сетевой ошибке', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());
    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.error).toContain('ENOTFOUND');
  });

  it('возвращает ok:false на 5xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch;
    const client = new TelegramProxyAdminClient(makeCfg());
    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(502);
    expect(r.error).toBe('HTTP 502');
  });
});
