/**
 * Unit-тесты DadataAdapter.
 *
 * Покрытие:
 *   - Без DADATA_API_KEY → null + warn-лог
 *   - Успешный LEGAL ответ → payerType='legal_entity'
 *   - Успешный INDIVIDUAL ответ → payerType='individual_entrepreneur'
 *   - HTTP 404 / 401 → null (не throw, fallback'у шанс)
 *   - Пустой suggestions[] → null
 *   - Timeout / network error → null (graceful)
 *
 * fetch мокается через vi.stubGlobal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { DadataAdapter } from './dadata.adapter';

function makeCfg(apiKey: string | undefined): TypedConfigService {
  return {
    billing: {
      dadata: { apiKey, isConfigured: Boolean(apiKey) },
    },
  } as unknown as TypedConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DadataAdapter', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('без API key возвращает null и не зовёт fetch', async () => {
    const adapter = new DadataAdapter(makeCfg(undefined));
    const result = await adapter.lookup('7707083893');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('успешный LEGAL → payerType=legal_entity', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        suggestions: [
          {
            data: {
              inn: '7707083893',
              kpp: '773601001',
              ogrn: '1027700132195',
              type: 'LEGAL',
              name: { full_with_opf: 'ПАО СБЕРБАНК' },
              address: { value: 'г. Москва, ул. Вавилова, 19' },
              management: { name: 'Греф Г.О.' },
            },
          },
        ],
      }),
    );
    const adapter = new DadataAdapter(makeCfg('test-token'));
    const result = await adapter.lookup('7707083893');
    expect(result).not.toBeNull();
    expect(result?.source).toBe('dadata');
    expect(result?.payerType).toBe('legal_entity');
    expect(result?.inn).toBe('7707083893');
    expect(result?.kpp).toBe('773601001');
    expect(result?.legalName).toBe('ПАО СБЕРБАНК');
    expect(result?.directorName).toBe('Греф Г.О.');
    expect(result?.legalAddress).toBe('г. Москва, ул. Вавилова, 19');

    // Проверяем что headers/body корректные
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party',
    );
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Token test-token');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ query: '7707083893', branch_type: 'MAIN' });
  });

  it('успешный INDIVIDUAL → payerType=individual_entrepreneur', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        suggestions: [
          {
            data: {
              inn: '500100732259',
              type: 'INDIVIDUAL',
              name: { full_with_opf: 'ИП Иванов И.И.' },
              address: { value: 'МО, Балашиха' },
            },
          },
        ],
      }),
    );
    const adapter = new DadataAdapter(makeCfg('test-token'));
    const result = await adapter.lookup('500100732259');
    expect(result?.payerType).toBe('individual_entrepreneur');
    expect(result?.kpp).toBeNull();
  });

  it('HTTP 404 → null (даём fallback\'у шанс)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'Not found' }));
    const adapter = new DadataAdapter(makeCfg('test-token'));
    expect(await adapter.lookup('0000000000')).toBeNull();
  });

  it('HTTP 401 (неверный ключ) → null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }));
    const adapter = new DadataAdapter(makeCfg('bad-token'));
    expect(await adapter.lookup('7707083893')).toBeNull();
  });

  it('пустой suggestions → null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { suggestions: [] }));
    const adapter = new DadataAdapter(makeCfg('test-token'));
    expect(await adapter.lookup('9999999999')).toBeNull();
  });

  it('suggestions без inn в data → null', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { suggestions: [{ data: { type: 'LEGAL' } }] }),
    );
    const adapter = new DadataAdapter(makeCfg('test-token'));
    expect(await adapter.lookup('9999999999')).toBeNull();
  });

  it('network error (fetch throws) → null, не падает', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = new DadataAdapter(makeCfg('test-token'));
    expect(await adapter.lookup('7707083893')).toBeNull();
  });
});
