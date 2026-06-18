import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { OpenAiProxyEmbeddingService } from './openai-proxy-embedding.service';

function makeCfg(overrides: { proxyApiKey?: string } = {}): TypedConfigService {
  return {
    ai: {
      openai: { apiKey: 'sk-real' },
      proxy: { prefix: 'myFeedproxy3128' },
      embeddings: {
        provider: 'openai-via-proxy',
        model: 'text-embedding-3-small',
        proxyApiKey: overrides.proxyApiKey ?? '',
        proxyEmbeddingsUrl: 'https://proxy.test/v1/embeddings',
        fallbackLocalUrl: '',
      },
    },
  } as unknown as TypedConfigService;
}

describe('OpenAiProxyEmbeddingService.embed', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('пустой массив — без HTTP-вызова', async () => {
    const svc = new OpenAiProxyEmbeddingService(makeCfg());
    const out = await svc.embed([]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('успех: возвращает embeddings + использует ключ из proxyApiKey, если задан', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
        usage: { prompt_tokens: 10, total_tokens: 12 },
      }),
    });
    const svc = new OpenAiProxyEmbeddingService(makeCfg({ proxyApiKey: 'sk-proxy' }));
    const out = await svc.embed(['hello', 'world']);
    expect(out).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer myFeedproxy3128:sk-proxy',
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toEqual(['hello', 'world']);
  });

  it('успех: fallback на cfg.openai.apiKey, если proxyApiKey пуст', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });
    const svc = new OpenAiProxyEmbeddingService(makeCfg({ proxyApiKey: '' }));
    await svc.embed(['x']);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer myFeedproxy3128:sk-real',
    );
  });

  it('HTTP 500 → бросает ошибку', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal',
    });
    const svc = new OpenAiProxyEmbeddingService(makeCfg());
    await expect(svc.embed(['x'])).rejects.toThrow(/HTTP 500/);
  });

  it('mismatch length → ошибка', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });
    const svc = new OpenAiProxyEmbeddingService(makeCfg());
    await expect(svc.embed(['a', 'b'])).rejects.toThrow(/ожидалось 2 embeddings/);
  });

  it('batch > 100: режет на чанки', async () => {
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: string[] };
      return {
        ok: true,
        json: async () => ({
          data: body.input.map(() => ({ embedding: [0.1] })),
        }),
      };
    });
    const texts = Array.from({ length: 250 }, (_, i) => `t-${i}`);
    const svc = new OpenAiProxyEmbeddingService(makeCfg());
    const out = await svc.embed(texts);
    expect(out).toHaveLength(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
