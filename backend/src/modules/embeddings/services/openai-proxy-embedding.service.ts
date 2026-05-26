import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { EmbeddingProvider } from '../embeddings.types';

/**
 * Embeddings через `proxy.agent-lia.ru/v1/embeddings` (OpenAI-совместимый ответ).
 *
 *   - URL: `cfg.ai.embeddings.proxyEmbeddingsUrl`.
 *   - Auth: `Authorization: Bearer <PROXY_PREFIX>:<key>`. Ключ берётся из
 *     `cfg.ai.embeddings.proxyApiKey`, иначе — `cfg.ai.openai.apiKey`.
 *   - Модель: `cfg.ai.embeddings.model`.
 *   - Лимит batch — 100 текстов за запрос. Если входных больше — делим на чанки.
 *
 * Метрика `embedding_tokens_total{provider='openai-proxy', status='success|failed'}`.
 */
@Injectable()
export class OpenAiProxyEmbeddingService implements EmbeddingProvider {
  readonly name = 'openai-proxy';
  private readonly logger = new Logger(OpenAiProxyEmbeddingService.name);
  private static readonly BATCH_LIMIT = 100;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += OpenAiProxyEmbeddingService.BATCH_LIMIT) {
      const slice = texts.slice(i, i + OpenAiProxyEmbeddingService.BATCH_LIMIT);
      const batch = await this.embedBatch(slice);
      for (const v of batch) result.push(v);
    }
    return result;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const url = this.cfg.ai.embeddings.proxyEmbeddingsUrl;
    const key =
      this.cfg.ai.embeddings.proxyApiKey || this.cfg.ai.openai.apiKey;
    const auth = `Bearer ${this.cfg.ai.proxy.prefix}:${key}`;

    const body = JSON.stringify({
      model: this.cfg.ai.embeddings.model,
      input: texts,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
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
      const e = new Error(
        `OpenAiProxyEmbedding HTTP ${response.status}: ${errText.slice(0, 500)}`,
      );
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
        `OpenAiProxyEmbedding: ожидалось ${texts.length} embeddings, получено ${arr.length}`,
      );
    }
    const embeddings: number[][] = arr.map((row, idx) => {
      const e = row.embedding;
      if (!Array.isArray(e)) {
        throw new Error(`OpenAiProxyEmbedding: пустой embedding в позиции ${idx}`);
      }
      return e;
    });

    const tokens =
      data.usage?.total_tokens ??
      data.usage?.prompt_tokens ??
      this.approxTokens(texts);
    this.metrics?.addEmbeddingTokens({
      provider: this.name,
      status: 'success',
      tokens,
    });
    this.logger.debug(`embed batch=${texts.length} tokens=${tokens}`);
    return embeddings;
  }

  /** Приблизительная оценка токенов — для метрик при ошибке. */
  private approxTokens(texts: string[]): number {
    let total = 0;
    for (const t of texts) total += Math.ceil(t.length / 4);
    return total;
  }
}
