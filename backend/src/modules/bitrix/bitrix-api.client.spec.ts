import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { BitrixApiClient, BitrixApiError } from './bitrix-api.client';

/**
 * Unit-тесты BitrixApiClient: глобальный fetch замокан, сети нет.
 */

function makeCfg(over: Partial<{ clientId: string; clientSecret: string }> = {}) {
  return {
    bitrix: {
      clientId: over.clientId ?? 'app.test',
      clientSecret: over.clientSecret ?? 'secret',
      oauthBaseUrl: 'https://oauth.bitrix.info',
    },
  } as unknown as TypedConfigService;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

describe('BitrixApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchangeCode: возвращает токены и шлёт grant_type=authorization_code', async () => {
    const client = new BitrixApiClient(makeCfg());
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        member_id: 'M1',
        client_endpoint: 'https://acme.bitrix24.ru/rest/',
      }),
    );

    const tokens = await client.exchangeCode('code123');

    expect(tokens.access_token).toBe('AT');
    expect(tokens.member_id).toBe('M1');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('grant_type=authorization_code');
    expect(url).toContain('code=code123');
    expect(url).toContain('client_secret=secret');
  });

  it('refresh: шлёт grant_type=refresh_token', async () => {
    const client = new BitrixApiClient(makeCfg());
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: 'AT2',
        refresh_token: 'RT2',
        expires_in: 3600,
        member_id: 'M1',
        client_endpoint: 'https://acme.bitrix24.ru/rest/',
      }),
    );

    const tokens = await client.refresh('RTold');

    expect(tokens.access_token).toBe('AT2');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('grant_type=refresh_token');
    expect(url).toContain('refresh_token=RTold');
  });

  it('token request без creds → BitrixApiError bitrix_misconfigured (не транзиентная)', async () => {
    const client = new BitrixApiClient(makeCfg({ clientId: '', clientSecret: '' }));
    await expect(client.exchangeCode('x')).rejects.toMatchObject({
      code: 'bitrix_misconfigured',
      transient: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh: error в теле → BitrixApiError с code, isTokenExpired для invalid_token', async () => {
    const client = new BitrixApiClient(makeCfg());
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'invalid_token', error_description: 'token bad' },
        false,
        401,
      ),
    );

    try {
      await client.refresh('RT');
      throw new Error('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(BitrixApiError);
      expect((e as BitrixApiError).code).toBe('invalid_token');
      expect((e as BitrixApiError).isTokenExpired).toBe(true);
    }
  });

  it('callMethod: error в теле (HTTP 200) → BitrixApiError', async () => {
    const client = new BitrixApiClient(makeCfg());
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'expired_token', error_description: 'expired' }),
    );

    await expect(
      client.callMethod('https://acme.bitrix24.ru/rest/', 'AT', 'app.info'),
    ).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('callMethod: result разворачивается; auth уходит в теле', async () => {
    const client = new BitrixApiClient(makeCfg());
    fetchMock.mockResolvedValue(jsonResponse({ result: { ID: 7 } }));

    const res = await client.callMethod<{ ID: number }>(
      'https://acme.bitrix24.ru/rest/',
      'AT',
      'app.info',
    );

    expect(res.ID).toBe(7);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.auth).toBe('AT');
  });
});
