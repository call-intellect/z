import { Inject, Injectable } from '@nestjs/common';

import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

import type { ExtractedBlock } from './block-extraction.service';

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

  async embedQuery(text: string): Promise<number[] | null> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    const [vec] = await this.embeddings.embed([trimmed]);
    return vec ?? null;
  }
}
