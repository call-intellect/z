/**
 * Unit-тесты TochkaOpenBankingAdapter.
 *
 * Покрытие:
 *   - Sandbox-режим → null (не делает HTTP)
 *   - !features.tochka → null
 *   - Нет access_token → null + warn
 *   - Match по inn → InnLookupResult с bankBik/account
 *   - Несовпадающий inn → null
 *   - HTTP 4xx/5xx → null (graceful)
 *   - Customer без kpp → payerType='individual_entrepreneur'
 *
 * fetch + OAuth моки через vi.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { TochkaOAuthService } from '../../billing/providers/tochka/tochka-oauth.service';

import { TochkaOpenBankingAdapter } from './tochka.adapter';

function makeCfg(over: {
  isSandbox?: boolean;
  isProduction?: boolean;
  tochkaEnabled?: boolean;
} = {}): TypedConfigService {
  return {
    billing: {
      features: { tochka: over.tochkaEnabled ?? true },
      tochka: {
        isSandbox: over.isSandbox ?? false,
        isProduction: over.isProduction ?? true,
        apiVersion: 'v1.0',
        baseUrl: 'https://enter.tochka.com/uapi/',
      },
    },
  } as unknown as TypedConfigService;
}

function makeOAuth(token: string | null): TochkaOAuthService {
  return {
    getAccessToken: vi.fn().mockResolvedValue(token),
  } as unknown as TochkaOAuthService;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TochkaOpenBankingAdapter', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('sandbox-режим → null, fetch не зовётся', async () => {
    const adapter = new TochkaOpenBankingAdapter(
      makeCfg({ isSandbox: true }),
      makeOAuth('any'),
    );
    const result = await adapter.lookup('7707083893');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('!features.tochka → null', async () => {
    const adapter = new TochkaOpenBankingAdapter(
      makeCfg({ tochkaEnabled: false }),
      makeOAuth('token'),
    );
    const result = await adapter.lookup('7707083893');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('OAuth не вернул токен → null', async () => {
    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth(null));
    const result = await adapter.lookup('7707083893');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('match по inn → возвращает результат с bankBik/account', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          Data: [{ customerCode: 'cust-1' }, { customerCode: 'cust-2' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          Data: {
            customerCode: 'cust-1',
            name: 'ООО "Точка"',
            inn: '9721194461',
            kpp: '772101001',
            ogrn: '1227700185803',
            address: 'г. Москва, Летниковская, 2',
            bankCode: '044525104',
            AccountList: [{ accountId: '40702810901234567890/044525104' }],
          },
        }),
      );

    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('valid-bearer'));
    const result = await adapter.lookup('9721194461');

    expect(result).not.toBeNull();
    expect(result?.source).toBe('tochka');
    expect(result?.payerType).toBe('legal_entity');
    expect(result?.inn).toBe('9721194461');
    expect(result?.kpp).toBe('772101001');
    expect(result?.legalName).toBe('ООО "Точка"');
    expect(result?.bankBik).toBe('044525104');
    expect(result?.bankAccount).toBe('40702810901234567890');

    // Bearer передан в обоих запросах.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers0 = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string> | undefined;
    expect(headers0?.Authorization).toBe('Bearer valid-bearer');
  });

  it('inn не совпадает ни у одного customer → null', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { Data: [{ customerCode: 'cust-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse(200, { Data: { customerCode: 'cust-1', inn: '9999999999' } }),
      );

    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('token'));
    expect(await adapter.lookup('7707083893')).toBeNull();
  });

  it('customer без kpp → payerType=individual_entrepreneur', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { Data: [{ customerCode: 'ip-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          Data: {
            customerCode: 'ip-1',
            name: 'ИП Иванов',
            inn: '500100732259',
            ogrn: '320500000000001',
            address: 'МО',
            AccountList: [],
          },
        }),
      );

    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('token'));
    const result = await adapter.lookup('500100732259');
    expect(result?.payerType).toBe('individual_entrepreneur');
    expect(result?.kpp).toBeNull();
  });

  it('пустой customers list → null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { Data: [] }));
    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('token'));
    expect(await adapter.lookup('7707083893')).toBeNull();
  });

  it('HTTP 401 на customers list → null (graceful)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('expired-token'));
    expect(await adapter.lookup('7707083893')).toBeNull();
  });

  it('Data в форме объекта {Customer: [...]} → парсится', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { Data: { Customer: [{ customerCode: 'cust-1' }] } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          Data: { customerCode: 'cust-1', name: 'X', inn: '7707083893', kpp: '1' },
        }),
      );
    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('token'));
    const result = await adapter.lookup('7707083893');
    expect(result?.inn).toBe('7707083893');
  });

  it('network error → null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = new TochkaOpenBankingAdapter(makeCfg(), makeOAuth('token'));
    expect(await adapter.lookup('7707083893')).toBeNull();
  });
});
