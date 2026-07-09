import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import {
  EmbeddingsAllProvidersFailedError,
  type EmbeddingProvider,
  LocalEmbeddingNotConfiguredError,
} from '../embeddings.types';

import { EmbeddingFallbackService } from './embedding-fallback.service';
import type {
  EmbeddingProviderResolverService,
  ResolvedEmbeddingProvider,
} from './embedding-provider-resolver.service';
import type { LocalEmbeddingService } from './local-embedding.service';
import type { OpenAiProxyEmbeddingService } from './openai-proxy-embedding.service';

function makeCfg(provider: 'openai-via-proxy' | 'local' = 'openai-via-proxy'): TypedConfigService {
  return {
    ai: { embeddings: { provider } },
    getDynamic: async (_key: string, _env: unknown, def: unknown) => def,
  } as unknown as TypedConfigService;
}

function fakeProvider(name: string, fn: EmbeddingProvider['embed']): EmbeddingProvider {
  return { name, embed: fn };
}

function makeResolver(chain: ResolvedEmbeddingProvider[] = []): EmbeddingProviderResolverService {
  return {
    resolveChain: vi.fn(async () => chain),
  } as unknown as EmbeddingProviderResolverService;
}

function makeSvc(opts: {
  cfg?: TypedConfigService;
  proxy: EmbeddingProvider;
  local: EmbeddingProvider;
  resolver?: EmbeddingProviderResolverService;
}): EmbeddingFallbackService {
  return new EmbeddingFallbackService(
    opts.cfg ?? makeCfg(),
    opts.proxy as unknown as OpenAiProxyEmbeddingService,
    opts.local as unknown as LocalEmbeddingService,
    opts.resolver ?? makeResolver([]),
  );
}

describe('EmbeddingFallbackService.embed', () => {
  it('пустой массив — без вызовов', async () => {
    const proxy = fakeProvider('openai-proxy', vi.fn(async () => []));
    const local = fakeProvider('local', vi.fn(async () => []));
    const svc = makeSvc({ proxy, local });
    expect(await svc.embed([])).toEqual([]);
    expect((proxy.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('default chain: proxy → local. proxy success — local не вызывается', async () => {
    const proxyEmbed = vi.fn(async () => [[0.1]]);
    const localEmbed = vi.fn(async () => [[0.2]]);
    const svc = makeSvc({
      cfg: makeCfg('openai-via-proxy'),
      proxy: fakeProvider('openai-proxy', proxyEmbed),
      local: fakeProvider('local', localEmbed),
    });
    const out = await svc.embed(['x']);
    expect(out).toEqual([[0.1]]);
    expect(localEmbed).not.toHaveBeenCalled();
  });

  it('default chain: proxy упал → fallback на local', async () => {
    const proxyEmbed = vi.fn(async () => {
      throw new Error('boom');
    });
    const localEmbed = vi.fn(async () => [[0.42]]);
    const svc = makeSvc({
      cfg: makeCfg('openai-via-proxy'),
      proxy: fakeProvider('openai-proxy', proxyEmbed),
      local: fakeProvider('local', localEmbed),
    });
    const out = await svc.embed(['x']);
    expect(out).toEqual([[0.42]]);
    expect(localEmbed).toHaveBeenCalledOnce();
  });

  it('local-first chain: provider=local → local → proxy', async () => {
    const proxyEmbed = vi.fn(async () => [[0.1]]);
    const localEmbed = vi.fn(async () => [[0.2]]);
    const svc = makeSvc({
      cfg: makeCfg('local'),
      proxy: fakeProvider('openai-proxy', proxyEmbed),
      local: fakeProvider('local', localEmbed),
    });
    const out = await svc.embed(['x']);
    expect(out).toEqual([[0.2]]);
    expect(proxyEmbed).not.toHaveBeenCalled();
  });

  it('оба упали → EmbeddingsAllProvidersFailedError', async () => {
    const proxyEmbed = vi.fn(async () => {
      throw new Error('proxy down');
    });
    const localEmbed = vi.fn(async () => {
      throw new LocalEmbeddingNotConfiguredError();
    });
    const svc = makeSvc({
      proxy: fakeProvider('openai-proxy', proxyEmbed),
      local: fakeProvider('local', localEmbed),
    });
    await expect(svc.embed(['x'])).rejects.toBeInstanceOf(EmbeddingsAllProvidersFailedError);
  });

  describe('DB-цепочка резолвера', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('(e) resolveChain непустой → embed идёт по DB-цепочке, а не по this.local/this.proxy', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.9, 0.8] }] }),
      });
      const proxyEmbed = vi.fn(async () => [[0.1]]);
      const localEmbed = vi.fn(async () => [[0.2]]);
      const resolver = makeResolver([
        {
          name: 'db-provider',
          baseUrl: 'https://db.test/v1',
          protocolKind: 'openai-embeddings',
          apiKey: 'sk-db',
          model: 'db-model',
          dimensions: 768,
        },
      ]);
      const svc = makeSvc({
        proxy: fakeProvider('openai-proxy', proxyEmbed),
        local: fakeProvider('local', localEmbed),
        resolver,
      });

      const out = await svc.embed(['x']);

      expect(out).toEqual([[0.9, 0.8]]);
      expect(proxyEmbed).not.toHaveBeenCalled();
      expect(localEmbed).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://db.test/v1/embeddings');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-db');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('db-model');
      expect(body.input).toEqual(['x']);
    });

    it('(f) resolveChain пустой → code-fallback на this.proxy/this.local (без сети)', async () => {
      const proxyEmbed = vi.fn(async () => [[0.1]]);
      const localEmbed = vi.fn(async () => [[0.2]]);
      const svc = makeSvc({
        cfg: makeCfg('openai-via-proxy'),
        proxy: fakeProvider('openai-proxy', proxyEmbed),
        local: fakeProvider('local', localEmbed),
        resolver: makeResolver([]),
      });

      const out = await svc.embed(['x']);

      expect(out).toEqual([[0.1]]);
      expect(proxyEmbed).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
