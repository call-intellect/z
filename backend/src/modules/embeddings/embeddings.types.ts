export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export class LocalEmbeddingNotConfiguredError extends Error {
  constructor() {
    super('LocalEmbeddingService: EMBEDDING_FALLBACK_LOCAL_URL не задан');
    this.name = 'LocalEmbeddingNotConfiguredError';
  }
}

export class EmbeddingsAllProvidersFailedError extends Error {
  constructor(readonly errors: Array<{ provider: string; message: string }>) {
    super(
      'EmbeddingFallbackService: все провайдеры упали: ' +
        errors.map((e) => `${e.provider}=${e.message}`).join('; '),
    );
    this.name = 'EmbeddingsAllProvidersFailedError';
  }
}

export interface TranscriptChunk {
  text: string;
  startMs: number;
  endMs: number;
}
