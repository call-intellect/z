/**
 * Контракт embedding-провайдера. Все провайдеры реализуют batch-API.
 *
 * Ответ — массив embedding'ов в том же порядке, что и `texts`.
 * Длина и размерность embedding'а определяется моделью провайдера
 * (`text-embedding-3-small` → 1536).
 */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Ошибка отсутствия конфига локального embedding-провайдера.
 * Бросается `LocalEmbeddingService.embed`, если `EMBEDDING_FALLBACK_LOCAL_URL`
 * не задан в ENV. Caller (`EmbeddingFallbackService`) ловит её и пробрасывает
 * `EmbeddingsAllProvidersFailedError`.
 */
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

/**
 * Чанк транскрипта, который индексируется. Хранится в `MeetingTranscriptChunk`.
 */
export interface TranscriptChunk {
  text: string;
  startMs: number;
  endMs: number;
}
