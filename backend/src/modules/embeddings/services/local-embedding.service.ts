import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { type EmbeddingProvider, LocalEmbeddingNotConfiguredError } from '../embeddings.types';

@Injectable()
export class LocalEmbeddingService implements EmbeddingProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalEmbeddingService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const baseUrl = this.cfg.ai.embeddings.fallbackLocalUrl;
    if (!baseUrl) {
      throw new LocalEmbeddingNotConfiguredError();
    }
    if (texts.length === 0) return [];

    const url = baseUrl.replace(/\/+$/u, '') + '/embeddings';
    const body = JSON.stringify({
      model: this.cfg.ai.embeddings.model,
      input: texts,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      this.metrics?.addEmbeddingTokens({
        provider: this.name,
        status: 'failed',
        tokens: this.approxTokens(texts),
      });
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.metrics?.addEmbeddingTokens({
        provider: this.name,
        status: 'failed',
        tokens: this.approxTokens(texts),
      });
      const e = new Error(`LocalEmbedding HTTP ${response.status}: ${errText.slice(0, 500)}`);
      Object.assign(e, { status: response.status });
      throw e;
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const arr = Array.isArray(data.data) ? data.data : [];
    if (arr.length !== texts.length) {
      this.metrics?.addEmbeddingTokens({
        provider: this.name,
        status: 'failed',
        tokens: this.approxTokens(texts),
      });
      throw new Error(
        `LocalEmbedding: ожидалось ${texts.length} embeddings, получено ${arr.length}`,
      );
    }
    const embeddings: number[][] = arr.map((row, idx) => {
      const e = row.embedding;
      if (!Array.isArray(e)) {
        throw new Error(`LocalEmbedding: пустой embedding в позиции ${idx}`);
      }
      return e;
    });

    const tokens =
      data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? this.approxTokens(texts);
    this.metrics?.addEmbeddingTokens({
      provider: this.name,
      status: 'success',
      tokens,
    });
    this.logger.debug(`embed batch=${texts.length} tokens=${tokens}`);
    return embeddings;
  }

  private approxTokens(texts: string[]): number {
    let total = 0;
    for (const t of texts) total += Math.ceil(t.length / 4);
    return total;
  }
}
