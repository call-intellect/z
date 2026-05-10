import { Inject, Injectable } from '@nestjs/common';

import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

import type { ExtractedBlock } from './block-extraction.service';

/**
 * KnowledgeEmbeddingService — обёртка над `EmbeddingFallbackService`
 * для batched-эмбеддинга блоков и сущностей.
 *
 * Логика «что эмбеддим»:
 *   - Блоки: `criticalQuestion + ' ' + trustedAnswer`. Это то, по чему ищем
 *     ближайшего канонического кандидата в block-distill.
 *   - Сущности: `canonicalName` (короткая строка достаточна для KNN).
 *
 * Батчинг — внутри `EmbeddingFallbackService.embed(...)` (он сам режет на
 * batch-100 по `EMBEDDING_BATCH_SIZE`).
 */
@Injectable()
export class KnowledgeEmbeddingService {
  constructor(
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
  ) {}

  async embedBlocks(blocks: ExtractedBlock[]): Promise<number[][]> {
    if (blocks.length === 0) return [];
    const texts = blocks.map((b) => `${b.criticalQuestion} ${b.trustedAnswer}`);
    return this.embeddings.embed(texts);
  }

  async embedEntityNames(names: string[]): Promise<number[][]> {
    if (names.length === 0) return [];
    return this.embeddings.embed(names);
  }
}
