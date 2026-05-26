import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import {
  EmbeddingsAllProvidersFailedError,
  type EmbeddingProvider,
  LocalEmbeddingNotConfiguredError,
} from '../embeddings.types';

import { EmbeddingFallbackService } from './embedding-fallback.service';
import type { LocalEmbeddingService } from './local-embedding.service';
import type { OpenAiProxyEmbeddingService } from './openai-proxy-embedding.service';

function makeCfg(provider: 'openai-via-proxy' | 'local' = 'openai-via-proxy'): TypedConfigService {
  return {
    ai: { embeddings: { provider } },
  } as unknown as TypedConfigService;
}

function fakeProvider(name: string, fn: EmbeddingProvider['embed']): EmbeddingProvider {
  return { name, embed: fn };
}

describe('EmbeddingFallbackService.embed', () => {
  it('пустой массив — без вызовов', async () => {
    const proxy = fakeProvider('openai-proxy', vi.fn(async () => []));
    const local = fakeProvider('local', vi.fn(async () => []));
    const svc = new EmbeddingFallbackService(
      makeCfg(),
      proxy as unknown as OpenAiProxyEmbeddingService,
      local as unknown as LocalEmbeddingService,
    );
    expect(await svc.embed([])).toEqual([]);
    expect((proxy.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('default chain: proxy → local. proxy success — local не вызывается', async () => {
    const proxyEmbed = vi.fn(async () => [[0.1]]);
    const localEmbed = vi.fn(async () => [[0.2]]);
    const svc = new EmbeddingFallbackService(
      makeCfg('openai-via-proxy'),
      fakeProvider('openai-proxy', proxyEmbed) as unknown as OpenAiProxyEmbeddingService,
      fakeProvider('local', localEmbed) as unknown as LocalEmbeddingService,
    );
    const out = await svc.embed(['x']);
    expect(out).toEqual([[0.1]]);
    expect(localEmbed).not.toHaveBeenCalled();
  });

  it('default chain: proxy упал → fallback на local', async () => {
    const proxyEmbed = vi.fn(async () => {
      throw new Error('boom');
    });
    const localEmbed = vi.fn(async () => [[0.42]]);
    const svc = new EmbeddingFallbackService(
      makeCfg('openai-via-proxy'),
      fakeProvider('openai-proxy', proxyEmbed) as unknown as OpenAiProxyEmbeddingService,
      fakeProvider('local', localEmbed) as unknown as LocalEmbeddingService,
    );
    const out = await svc.embed(['x']);
    expect(out).toEqual([[0.42]]);
    expect(localEmbed).toHaveBeenCalledOnce();
  });

  it('local-first chain: provider=local → local → proxy', async () => {
    const proxyEmbed = vi.fn(async () => [[0.1]]);
    const localEmbed = vi.fn(async () => [[0.2]]);
    const svc = new EmbeddingFallbackService(
      makeCfg('local'),
      fakeProvider('openai-proxy', proxyEmbed) as unknown as OpenAiProxyEmbeddingService,
      fakeProvider('local', localEmbed) as unknown as LocalEmbeddingService,
    );
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
    const svc = new EmbeddingFallbackService(
      makeCfg(),
      fakeProvider('openai-proxy', proxyEmbed) as unknown as OpenAiProxyEmbeddingService,
      fakeProvider('local', localEmbed) as unknown as LocalEmbeddingService,
    );
    await expect(svc.embed(['x'])).rejects.toBeInstanceOf(EmbeddingsAllProvidersFailedError);
  });
});
