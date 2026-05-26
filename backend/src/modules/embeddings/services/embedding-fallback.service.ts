import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import {
  type EmbeddingProvider,
  EmbeddingsAllProvidersFailedError,
} from '../embeddings.types';

import { LocalEmbeddingService } from './local-embedding.service';
import { OpenAiProxyEmbeddingService } from './openai-proxy-embedding.service';

/**
 * Каскад embedding-провайдеров.
 *
 *   - `EMBEDDING_PROVIDER='openai-via-proxy'` (default) — proxy → local.
 *   - `EMBEDDING_PROVIDER='local'`                       — local → proxy.
 *   - `EMBEDDING_PROVIDER='openai-direct'`               — пока трактуем как proxy
 *     (в Z прямой выход на OpenAI не настроен — proxy идентичен по контракту).
 *
 * Если оба упали → `EmbeddingsAllProvidersFailedError`.
 */
@Injectable()
export class EmbeddingFallbackService implements EmbeddingProvider {
  readonly name = 'embedding-fallback';
  private readonly logger = new Logger(EmbeddingFallbackService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(OpenAiProxyEmbeddingService)
    private readonly proxy: OpenAiProxyEmbeddingService,
    @Inject(LocalEmbeddingService)
    private readonly local: LocalEmbeddingService,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const chain = this.buildChain();
    const errors: Array<{ provider: string; message: string }> = [];

    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i] as EmbeddingProvider;
      try {
        return await provider.embed(texts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ provider: provider.name, message });
        this.logger.warn(
          `EmbeddingFallback: ${provider.name} упал (${message}); ` +
            (i < chain.length - 1 ? 'переход к следующему' : 'провайдеры исчерпаны'),
        );
      }
    }
    throw new EmbeddingsAllProvidersFailedError(errors);
  }

  private buildChain(): EmbeddingProvider[] {
    const primary = this.cfg.ai.embeddings.provider;
    if (primary === 'local') {
      return [this.local, this.proxy];
    }
    // openai-via-proxy и openai-direct трактуем одинаково.
    return [this.proxy, this.local];
  }
}
