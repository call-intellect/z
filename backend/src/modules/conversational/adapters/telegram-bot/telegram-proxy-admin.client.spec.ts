import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { RedisService } from '../../../../common/redis/redis.service';

import {
  TelegramProxyAdminClient,
  TelegramProxyAdminError,
} from './telegram-proxy-admin.client';

/**
 * Unit-тесты `TelegramProxyAdminClient` (Фаза 1 ТЗ
 * plans/tz/2026-05-26-telegram-via-crossmark-proxy.md).
 *
 * Покрываем:
 *   - login() возвращает кэшированный JWT из Redis, не дёргая прокси.
 *   - forceLogin() обращается к /auth/login, кэширует с TTL по `exp`.
 *   - login() кидает понятную ошибку если прокси выключен / кредов нет.
 *   - ping() возвращает {ok:true} на 2xx, {ok:false} на сеть/HTTP-ошибку.
 */

const ORIGINAL_FETCH = globalThis.fetch;

function makeCfg(overrides: Partial<{
  enabled: boolean;
  adminEmail: string | undefined;
  adminPassword: string | undefined;
}> = {}): TypedConfigService {
  return {
    telegramProxy: {
      enabled: overrides.enabled ?? true,
      apiBase: 'https://proxy.test',
      fileBase: 'https://proxy.test',
      adminEmail: 'adminEmail' in overrides ? overrides.adminEmail : 'admin@test',
      adminPassword: 'adminPassword' in overrides ? overrides.adminPassword : 'pwd',
      jwtPrefetchSec: 60,
      requestTimeoutMs: 0,
      healthIntervalSec: 0,
    },
  } as unknown as TypedConfigService;
}

function makeRedis(initial: Record<string, string> = {}): {
  redis: RedisService;
  store: Record<string, { value: string; ttl?: number }>;
} {
  const store: Record<string, { value: string; ttl?: number }> = {};
  for (const [k, v] of Object.entries(initial)) store[k] = { value: v };
  const client = {
    get: vi.fn(async (key: string) => store[key]?.value ?? null),
    set: vi.fn(async (key: string, value: string, _mode: string, ttl: number) => {
      store[key] = { value, ttl };
      return 'OK';
    }),
  };
  return {
    redis: { client } as unknown as RedisService,
    store,
  };
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('TelegramProxyAdminClient.login', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('возвращает кэшированный JWT, не дёргая /auth/login', async () => {
    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'cached-jwt' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const token = await client.login();

    expect(token).toBe('cached-jwt');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('forceLogin POST-ит /auth/login и кэширует JWT с TTL по exp', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = makeJwt({ exp: nowSec + 3600 });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ token: jwt }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const { redis, store } = makeRedis();

    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    const token = await client.forceLogin();

    expect(token).toBe(jwt);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://proxy.test/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    const cached = store[TelegramProxyAdminClient.JWT_REDIS_KEY];
    expect(cached?.value).toBe(jwt);
    // TTL ≈ exp - now - prefetchSec(60) = ~3540 ± 5
    expect(cached?.ttl).toBeGreaterThan(3500);
    expect(cached?.ttl).toBeLessThanOrEqual(3600);
  });

  it('бросает TelegramProxyAdminError если прокси выключен', async () => {
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg({ enabled: false }), redis);

    await expect(client.forceLogin()).rejects.toThrow(TelegramProxyAdminError);
    await expect(client.forceLogin()).rejects.toThrow(/TELEGRAM_PROXY_ENABLED=false/);
  });

  it('бросает TelegramProxyAdminError если креды не заданы', async () => {
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(
      makeCfg({ adminEmail: undefined, adminPassword: undefined }),
      redis,
    );

    await expect(client.forceLogin()).rejects.toThrow(/ADMIN_EMAIL/);
  });

  it('бросает TelegramProxyAdminError на 4xx ответ', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const err = await client.forceLogin().catch((e) => e);
    expect(err).toBeInstanceOf(TelegramProxyAdminError);
    expect((err as TelegramProxyAdminError).status).toBe(401);
    expect((err as TelegramProxyAdminError).transient).toBe(false);
  });

  it('бросает TelegramProxyAdminError на 5xx как transient', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('upstream down', { status: 503 }),
    ) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const err = await client.forceLogin().catch((e) => e);
    expect(err).toBeInstanceOf(TelegramProxyAdminError);
    expect((err as TelegramProxyAdminError).status).toBe(503);
    expect((err as TelegramProxyAdminError).transient).toBe(true);
  });

  it('бросает на login-ответ без JWT-поля', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ unexpected: 'field' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    await expect(client.forceLogin()).rejects.toThrow(/не содержит JWT/);
  });

  it('принимает access_token как альтернативу token', async () => {
    const jwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 1800 });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: jwt }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const token = await client.forceLogin();
    expect(token).toBe(jwt);
  });
});

describe('TelegramProxyAdminClient.upsertBot', () => {
  it('GET /api/bots пуст → POST /api/bots (создание)', async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method, body });
      if (url.endsWith('/api/bots') && (init?.method === 'GET' || init?.method === undefined)) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/bots') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'bot-new-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'jwt-cached' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    const info = await client.upsertBot({
      token: '111:secret-token',
      secretToken: 'webhook-secret-1',
      targetUrl: 'https://app.example/api/v1/webhooks/telegram-bot',
    });

    expect(info.id).toBe('bot-new-1');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.body).toEqual({
      token: '111:secret-token',
      secret_token: 'webhook-secret-1',
      target_url: 'https://app.example/api/v1/webhooks/telegram-bot',
    });
  });

  it('GET /api/bots возвращает существующего → PUT /api/bots/:id (обновление)', async () => {
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/bots') && (init?.method === 'GET' || !init?.method)) {
        return new Response(
          JSON.stringify({ items: [{ id: 'bot-existing-9', token_masked: '111****-token' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/bots/bot-existing-9') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ id: 'bot-existing-9' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected', { status: 500 });
    }) as unknown as typeof fetch;

    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'jwt' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    const info = await client.upsertBot({
      token: '111:secret-token',
      secretToken: 'sec',
      targetUrl: 'https://app/api/v1/webhooks/telegram-bot',
    });
    expect(info.id).toBe('bot-existing-9');
  });

  it('targetUrl без https:// → бросает', async () => {
    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'jwt' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    await expect(
      client.upsertBot({
        token: 'x',
        secretToken: 'y',
        targetUrl: 'http://insecure/webhook',
      }),
    ).rejects.toThrow(/https:\/\//);
  });

  it('пустой token → бросает', async () => {
    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'jwt' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    await expect(
      client.upsertBot({ token: '', secretToken: 'y', targetUrl: 'https://x/y' }),
    ).rejects.toThrow(/token/);
  });

  it('ответ POST без id → бросает', async () => {
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/bots') && (init?.method === 'GET' || !init?.method)) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ message: 'ok' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'jwt' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    await expect(
      client.upsertBot({
        token: 'tok',
        secretToken: 'sec',
        targetUrl: 'https://app/webhook',
      }),
    ).rejects.toThrow(/id бота/);
  });
});

describe('TelegramProxyAdminClient.apiRequest retry-on-401', () => {
  it('на 401 делает forceLogin и повторяет запрос', async () => {
    const jwt2 = makeJwt({ exp: Math.floor(Date.now() / 1000) + 1800 });
    const attempts: Array<{ auth?: string; method?: string }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      attempts.push({ auth: headers.Authorization, method: init?.method });
      if (url.endsWith('/auth/login')) {
        return new Response(JSON.stringify({ token: jwt2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Первый GET → 401, второй → 200.
      const gets = attempts.filter((a) => a.method === 'GET').length;
      if (gets === 1) return new Response('', { status: 401 });
      return new Response(JSON.stringify({ result: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { redis } = makeRedis({ [TelegramProxyAdminClient.JWT_REDIS_KEY]: 'stale-jwt' });
    const client = new TelegramProxyAdminClient(makeCfg(), redis);
    const r = await client.apiRequest<{ result: string }>('GET', '/api/something', undefined);
    expect(r.result).toBe('ok');
    // attempts собирает только GET-запросы с заголовком Authorization
    // (`/auth/login` идёт через POST и тоже попадает в attempts).
    const callsArg = (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, RequestInit?]> } })
      .mock.calls;
    const loginCalls = callsArg.filter(([u]) => String(u).endsWith('/auth/login'));
    expect(loginCalls).toHaveLength(1);
    const getCalls = callsArg.filter(
      ([u, init]) => init?.method === 'GET' && String(u).endsWith('/api/something'),
    );
    expect(getCalls).toHaveLength(2);
    // На втором вызове Authorization должен быть свежим JWT.
    const secondAuth = (getCalls[1]?.[1]?.headers as Record<string, string>)?.Authorization;
    expect(secondAuth).toBe(`Bearer ${jwt2}`);
  });
});

describe('TelegramProxyAdminClient.ping', () => {
  it('возвращает ok:true на 200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const r = await client.ping();
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('возвращает ok:false при сетевой ошибке', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.error).toContain('ENOTFOUND');
  });

  it('возвращает ok:false на 5xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch;
    const { redis } = makeRedis();
    const client = new TelegramProxyAdminClient(makeCfg(), redis);

    const r = await client.ping();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(502);
    expect(r.error).toBe('HTTP 502');
  });
});
