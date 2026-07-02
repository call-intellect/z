import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverProviderModels } from './discover-provider-models.util';

describe('discoverProviderModels', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('успех: {data:[{id},{id}]} → возвращает список моделей', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'm1' }, { id: 'm2' }] }),
    });

    const out = await discoverProviderModels({ baseUrl: 'https://api.test/v1', apiKey: 'sk-1' });

    expect(out).toEqual([{ id: 'm1' }, { id: 'm2' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
  });

  it('без apiKey — не шлёт Authorization', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await discoverProviderModels({ baseUrl: 'https://api.test/v1', apiKey: null });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('элементы без id / не-строка id — отфильтровываются', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'm1' }, {}, { id: 123 }, { id: 'm2' }] }),
    });

    const out = await discoverProviderModels({ baseUrl: 'https://api.test/v1', apiKey: null });

    expect(out).toEqual([{ id: 'm1' }, { id: 'm2' }]);
  });

  it('HTTP не-2xx → throw с текстом статуса', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });

    await expect(
      discoverProviderModels({ baseUrl: 'https://api.test/v1', apiKey: null }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('сетевая ошибка (fetch rejects) → пробрасывается как есть', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      discoverProviderModels({ baseUrl: 'https://api.test/v1', apiKey: null }),
    ).rejects.toThrow('network down');
  });
});
