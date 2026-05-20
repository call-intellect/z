import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Service } from '../recordings/s3.service';

import { EmbeddingFallbackService } from './services/embedding-fallback.service';
import { LocalEmbeddingService } from './services/local-embedding.service';
import { OpenAiProxyEmbeddingService } from './services/openai-proxy-embedding.service';
import { TranscriptIndexerService } from './services/transcript-indexer.service';

/**
 * Embeddings — отдельный модуль с провайдерами и индексером транскрипта.
 *
 * Экспортирует:
 *   - `EmbeddingFallbackService` — для других модулей (chat/RAG).
 *   - `TranscriptIndexerService` — для воркера `transcript-index`.
 *   - `OpenAiProxyEmbeddingService` / `LocalEmbeddingService` — на случай,
 *      если кто-то захочет работать с конкретным провайдером (например, бенчмарк).
 *
 * `S3Service` — providet локально, потому что `RecordingsModule` HTTP-only,
 *  а индексер работает в worker-процессе тоже.
 *
 * @Global — чтобы `EmbeddingFallbackService` был виден @Global `KnowledgeCoreModule`
 * и в worker-процессе (на HTTP это давал @Global-реэкспорт `AiModule`).
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    S3Service,
    OpenAiProxyEmbeddingService,
    LocalEmbeddingService,
    EmbeddingFallbackService,
    TranscriptIndexerService,
  ],
  exports: [
    OpenAiProxyEmbeddingService,
    LocalEmbeddingService,
    EmbeddingFallbackService,
    TranscriptIndexerService,
  ],
})
export class EmbeddingsModule {}
