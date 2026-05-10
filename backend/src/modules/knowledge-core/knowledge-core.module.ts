import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Service } from '../recordings/s3.service';

import { KnowledgeBlocksController } from './api/blocks.controller';
import { KnowledgeEntitiesController } from './api/entities.controller';
import { KnowledgeSearchController } from './api/search.controller';
import { SearchService } from './api/search.service';
import { BlockExtractionService } from './services/block-extraction.service';
import { BlockLinkService } from './services/block-link.service';
import { BlockMergeService } from './services/block-merge.service';
import { KnowledgeEmbeddingService } from './services/embedding.service';
import { EntityMergeService } from './services/entity-merge.service';
import { EntityResolutionService } from './services/entity-resolution.service';
import { SegmentBuilderService } from './services/segment-builder.service';

/**
 * KnowledgeCoreModule — оркестрация ingest → distill для IdeaBlock'ов.
 *
 * Содержит только сервисы (не воркеры — они зарегистрированы в WorkersModule
 * и поднимаются в worker-процессе через `bun run worker:dev`).
 *
 * Зависимости (берём через глобальные DI-провайдеры):
 *   - `LlmRouterService` — из `AiModule` (Global, на HTTP-side) или
 *     зарегистрирован напрямую в `WorkersModule`.
 *   - `EmbeddingFallbackService` — из `EmbeddingsModule` (импортируется и в
 *     AiModule, и в WorkersModule).
 *   - `CoreQueueService` — из `CoreQueueModule` (Global).
 *   - `PrismaModule`, `RedisModule` — глобальные.
 *   - `S3Service` — provider'им локально (модуль recordings — HTTP-only).
 *
 * Помечаем `@Global()`, чтобы воркеры в `WorkersModule` могли инжектить
 * `BlockExtractionService` / `EntityResolutionService` / `SegmentBuilderService`
 * без явного импорта самого модуля несколько раз.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [
    KnowledgeSearchController,
    KnowledgeBlocksController,
    KnowledgeEntitiesController,
  ],
  providers: [
    S3Service,
    SegmentBuilderService,
    BlockExtractionService,
    KnowledgeEmbeddingService,
    EntityResolutionService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    SearchService,
  ],
  exports: [
    SegmentBuilderService,
    BlockExtractionService,
    KnowledgeEmbeddingService,
    EntityResolutionService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    SearchService,
  ],
})
export class KnowledgeCoreModule {}
