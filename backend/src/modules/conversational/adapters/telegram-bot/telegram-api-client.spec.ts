import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { RedisService } from '../../../../common/redis/redis.service';

import { TelegramApiClient, TelegramApiError } from './telegram-api-client';

/**
 * Тесты `TelegramApiClient` Фазы 2 ТЗ
 * plans/tz/2026-05-26-telegram-via-crossmark-proxy.md:
 *
 *   - proxy enabled → URL строится через прокси-base.
 *   - proxy enabled → outcome=ok / proxy_5xx / telegram_4xx по характеру ответа.
 *   - proxy enabled → durationSec пишется в гистограмму.
 *   - proxy disabled → URL строится через direct base (legacy).
 *   - proxy disabled → метрики proxy не пишутся.
 *   - downloadFile использует fileBase (а не apiBase) когда они различаются.
 *   - timeout: AbortController срабатывает.
 */

const ORIGINAL_FETCH = globalThis.fetch;

function makeCfg(overrides: {
  proxyEnabled?: boolean;
  proxyApiBase?: string;
  proxyFileBase?: string;
  directApiBase?: string;
  timeoutMs?: number;
  globalRps?: number;
} = {}): TypedConfigService {
  return {
    telegramProxy: {
      enabled: overrides.proxyEnabled ?? true,
      apiBase: overrides.proxyApiBase ?? 'https://proxy.test',
      fileBase: overrides.proxyFileBase ?? 'https://proxy.test',
      adminEmail: 'admin@test',
      adminPassword: 'pwd',
      jwtPrefetchSec: 60,
      requestTimeoutMs: overrides.timeoutMs ?? 0,
      healthIntervalSec: 0,
    },
    telegramBot: {
      apiBase: overrides.directApiBase ?? 'https://api.telegram.org',
      globalRps: overrides.globalRps ?? 0, // 0 → throttle no-op
    },
  } as unknown as TypedConfigService;
}

function makeMetrics(): {
  metrics: BusinessMetricsService;
  proxyRequests: Array<{ apiMethod: string; outcome: string }>;
  proxyDurations: Array<{ apiMethod: string; durationSec: number }>;
  apiErrors: Array<{ apiMethod: string; code: string }>;
} {
  const proxyRequests: Array<{ apiMethod: string; outcome: string }> = [];
  const proxyDurations: Array<{ apiMethod: string; durationSec: number }> = [];
  const apiErrors: Array<{ apiMethod: string; code: string }> = [];
  const metrics = {
    incTelegramProxyRequest: vi.fn((a) => proxyRequests.push(a)),
    observeTelegramProxyRequestDuration: vi.fn((a) => proxyDurations.push(a)),
    incTelegramBotApiError: vi.fn((a) => apiErrors.push(a)),
  } as unknown as BusinessMetricsService;
  return { metrics, proxyRequests, proxyDurations, apiErrors };
}

function makeRedis(): RedisService {
  return {
    client: {
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    },
  } as unknown as RedisService;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.clearAllMocks();
});

describe('TelegramApiClient (proxy mode)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it('строит URL с прокси-base при enabled=true', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 42 } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { metrics, proxyRequests, proxyDurations } = makeMetrics();
    const client = new TelegramApiClient(makeCfg(), makeRedis(), metrics);

    await client.sendMessage({ token: 'TOK', chatId: 42, text: 'hi' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = (fetchSpy.mock.calls as unknown as Array<[string, unknown?]>)[0]?.[0] as string;
    expect(firstCall).toBe('https://proxy.test/botTOK/sendMessage');
    expect(proxyRequests).toEqual([{ apiMethod: 'sendMessage', outcome: 'ok' }]);
    expect(proxyDurations).toHaveLength(1);
    expect(proxyDurations[0]?.durationSec).toBeGreaterThanOrEqual(0);
  });

  it('классифицирует Telegram 400 ответ (ok:false) как telegram_4xx', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { metrics, proxyRequests } = makeMetrics();
    const client = new TelegramApiClient(makeCfg(), makeRedis(), metrics);

    await expect(
      client.sendMessage({ token: 'TOK', chatId: 1, text: 'x' }),
    ).rejects.toBeInstanceOf(TelegramApiError);

    expect(proxyRequests).toEqual([{ apiMethod: 'sendMessage', outcome: 'telegram_4xx' }]);
  });

  it('классифицирует non-JSON 502 (HTML/plain) как proxy_5xx', async () => {
    mockFetch(async () =>
      new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const { metrics, proxyRequests } = makeMetrics();
    const client = new TelegramApiClient(makeCfg(), makeRedis(), metrics);

    const err = await client
      .sendMessage({ token: 'TOK', chatId: 1, text: 'x' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect((err as TelegramApiError).code).toBe(502);
    expect((err as TelegramApiError).transient).toBe(true);
    expect(proxyRequests).toEqual([{ apiMethod: 'sendMessage', outcome: 'proxy_5xx' }]);
  });

  it('классифицирует сетевую ошибку как network', async () => {
    mockFetch(async () => {
      throw new Error('ECONNRESET');
    });
    const { metrics, proxyRequests } = makeMetrics();
    const client = new TelegramApiClient(makeCfg(), makeRedis(), metrics);

    await expect(
      client.sendMessage({ token: 'TOK', chatId: 1, text: 'x' }),
    ).rejects.toBeInstanceOf(TelegramApiError);

    expect(proxyRequests).toEqual([{ apiMethod: 'sendMessage', outcome: 'network' }]);
  });

  it('downloadFile использует fileBase', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { metrics, proxyRequests } = makeMetrics();
    const client = new TelegramApiClient(
      makeCfg({ proxyFileBase: 'https://files.proxy.test' }),
      makeRedis(),
      metrics,
    );

    const buf = await client.downloadFile({ token: 'TOK', filePath: 'voice/file_1.ogg' });

    expect((fetchSpy.mock.calls as unknown as Array<[string, unknown?]>)[0]?.[0]).toBe(
      'https://files.proxy.test/file/botTOK/voice/file_1.ogg',
    );
    expect(buf.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(proxyRequests).toEqual([{ apiMethod: 'downloadFile', outcome: 'ok' }]);
  });

  it('срабатывает timeout (AbortController)', async () => {
    mockFetch((_url, init) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    });
    const { metrics, proxyRequests } = makeMetrics();
    const client = new TelegramApiClient(makeCfg({ timeoutMs: 30 }), makeRedis(), metrics);

    await expect(
      client.sendMessage({ token: 'TOK', chatId: 1, text: 'x' }),
    ).rejects.toBeInstanceOf(TelegramApiError);

    expect(proxyRequests).toEqual([{ apiMethod: 'sendMessage', outcome: 'network' }]);
  });
});

describe('TelegramApiClient (direct mode, legacy)', () => {
  it('строит URL с direct apiBase при enabled=false', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 1 } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { metrics, proxyRequests } = makeMetrics();
    const client = new TelegramApiClient(
      makeCfg({ proxyEnabled: false, directApiBase: 'https://api.telegram.org' }),
      makeRedis(),
      metrics,
    );

    await client.sendMessage({ token: 'TOK', chatId: 1, text: 'x' });

    expect((fetchSpy.mock.calls as unknown as Array<[string, unknown?]>)[0]?.[0]).toBe('https://api.telegram.org/botTOK/sendMessage');
    // Прокси-метрики не пишутся в direct mode.
    expect(proxyRequests).toEqual([]);
  });

  it('downloadFile использует direct apiBase когда proxy disabled', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([7]), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { metrics } = makeMetrics();
    const client = new TelegramApiClient(
      makeCfg({ proxyEnabled: false, directApiBase: 'https://api.telegram.org' }),
      makeRedis(),
      metrics,
    );

    await client.downloadFile({ token: 'TOK', filePath: 'v/f.ogg' });
    expect((fetchSpy.mock.calls as unknown as Array<[string, unknown?]>)[0]?.[0]).toBe('https://api.telegram.org/file/botTOK/v/f.ogg');
  });
});
