import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { type EmbeddingProvider, EmbeddingsAllProvidersFailedError } from '../embeddings.types';

import { EmbeddingProviderResolverService } from './embedding-provider-resolver.service';
import { LocalEmbeddingService } from './local-embedding.service';
import { openaiCompatibleEmbed } from './openai-compatible-embed.util';
import { OpenAiProxyEmbeddingService } from './openai-proxy-embedding.service';

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
    @Inject(EmbeddingProviderResolverService)
    private readonly resolver: EmbeddingProviderResolverService,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const chain = await this.buildChain();
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

  private async buildChain(): Promise<EmbeddingProvider[]> {
    const resolved = await this.resolver.resolveChain();
    if (resolved.length > 0) {
      return resolved.map((r) => ({
        name: r.name,
        embed: (texts: string[]) =>
          openaiCompatibleEmbed({
            baseUrl: r.baseUrl,
            model: r.model,
            apiKey: r.apiKey,
            texts,
          }),
      }));
    }

    const primary = this.cfg.ai.embeddings.provider;
    if (primary === 'local') {
      return [this.local, this.proxy];
    }
    return [this.proxy, this.local];
  }
}
