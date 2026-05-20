import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Service } from '../recordings/s3.service';

import { SearchService } from './api/search.service';
import { BlockExtractionService } from './services/block-extraction.service';
import { BlockFetchService } from './services/block-fetch.service';
import { BlockLinkService } from './services/block-link.service';
import { BlockMergeService } from './services/block-merge.service';
import { CardRollupV2Service } from './services/card-rollup-v2.service';
import { ChaptersExtractorV2Service } from './services/chapters-extractor-v2.service';
import { ChatV2RetrievalService } from './services/chat-v2-retrieval.service';
import { ChatV2Service } from './services/chat-v2.service';
import { ClusteringService } from './services/clustering.service';
import { KnowledgeEmbeddingService } from './services/embedding.service';
import { EntityGraphService } from './services/entity-graph.service';
import { EntityMergeService } from './services/entity-merge.service';
import { EntityResolutionService } from './services/entity-resolution.service';
import { SegmentBuilderService } from './services/segment-builder.service';
import { SummaryExtractorV2Service } from './services/summary-extractor-v2.service';
import { TasksExtractorV2Service } from './services/tasks-extractor-v2.service';
import { ThemeClassificationService } from './services/theme-classification.service';
import { CoreMetricsSnapshotCron } from './workers/core-metrics-snapshot.cron';

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
 *
 * HTTP-контроллеры вынесены в `KnowledgeCoreApiModule` — чтобы worker-процесс,
 * импортирующий этот сервис-модуль, не инстанцировал контроллеры и их auth-guard'ы
 * (CookieAuthGuard/TenantGuard), которым в воркере нет места.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    S3Service,
    SegmentBuilderService,
    BlockExtractionService,
    KnowledgeEmbeddingService,
    EntityResolutionService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    EntityGraphService,
    SearchService,
    // Фаза 4: Theme + clusterer + card-rollup-v2.
    ClusteringService,
    ThemeClassificationService,
    CardRollupV2Service,
    // Фаза 5: meeting-analyze-v2 (Tasks-2.0/Chapters-2.0/Summary-2.0).
    BlockFetchService,
    TasksExtractorV2Service,
    ChaptersExtractorV2Service,
    SummaryExtractorV2Service,
    // Фаза 6: ChatV2 (единый AI-чат поверх IdeaBlock'ов, 5 scope).
    ChatV2RetrievalService,
    ChatV2Service,
    // Фаза 11: snapshot-cron для core_* gauge'ев.
    CoreMetricsSnapshotCron,
  ],
  exports: [
    SegmentBuilderService,
    BlockExtractionService,
    KnowledgeEmbeddingService,
    EntityResolutionService,
    BlockMergeService,
    EntityMergeService,
    BlockLinkService,
    EntityGraphService,
    SearchService,
    ClusteringService,
    ThemeClassificationService,
    CardRollupV2Service,
    // Фаза 5: экспортируем для воркеров (`MeetingAnalyzeV2Worker` и
    // `MeetingAnalyzeV2Cron` живут в WorkersModule).
    BlockFetchService,
    TasksExtractorV2Service,
    ChaptersExtractorV2Service,
    SummaryExtractorV2Service,
    // Фаза 6: ChatV2 экспортируется, чтобы chat.service из ChatModule мог
    // его инжектить (этот модуль @Global, поэтому импортирует прозрачно).
    ChatV2RetrievalService,
    ChatV2Service,
  ],
})
export class KnowledgeCoreModule {}
