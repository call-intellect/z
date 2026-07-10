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
    const attempts = Math.max(
      1,
      await this.cfg.getDynamic<number>('embeddings.providerRetryAttempts', undefined, 2),
    );

    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i] as EmbeddingProvider;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await provider.embed(texts);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ provider: provider.name, message });
          const lastAttempt = attempt === attempts;
          this.logger.warn(
            `EmbeddingFallback: ${provider.name} упал (попытка ${attempt}/${attempts}: ${message}); ` +
              (!lastAttempt
                ? 'повтор'
                : i < chain.length - 1
                  ? 'переход к следующему'
                  : 'провайдеры исчерпаны'),
          );
          if (!lastAttempt) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
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
