import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { ConfigModule } from '../../common/config/index';
import { LoggerModule } from '../../common/logger/logger.module';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { MeetingIngestAdapter } from '../ingest/adapters/meeting.adapter';
import { IngestService } from '../ingest/ingest.service';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module';
import { BlockDistillWorker } from '../knowledge-core/workers/block-distill.worker';
import { BlockIngestWorker } from '../knowledge-core/workers/block-ingest.worker';
import { BlockLinkerWorker } from '../knowledge-core/workers/block-linker.worker';
import { EntityResolverCronService } from '../knowledge-core/workers/entity-resolver.cron';
import { EntityResolverWorker } from '../knowledge-core/workers/entity-resolver.worker';
import { S3Service } from '../recordings/s3.service';
import { JwtService } from '../auth/services/jwt.service';
import { UsersService } from '../users/users.service';
import { UsersRepository } from '../users/users.repository';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { MeetingsService } from '../meetings/meetings.service';

import { AiQueueService } from './ai-queue.service';
import { AnalyzeWorker } from './workers/analyze.worker';
import { CardRollupWorker } from './workers/card-rollup.worker';
import { ChaptersWorker } from './workers/chapters.worker';
import { ClipRenderWorker } from './workers/clip-render.worker';
import { MergeWorker } from './workers/merge.worker';
import { NotifyWorker } from './workers/notify.worker';
import { TasksExtractWorker } from './workers/tasks-extract.worker';
import { TranscribeWorker } from './workers/transcribe.worker';
import { TranscriptIndexWorker } from './workers/transcript-index.worker';
import { AiUsageLogService } from './services/ai-usage-log.service';
import { AnthropicService } from './services/anthropic.service';
import { CardRollupService } from './services/card-rollup.service';
import { ChapterExtractionService } from './services/chapter-extraction.service';
import { DeepSeekService } from './services/deepseek.service';
import { LlmFallbackService } from './services/llm-fallback.service';
import { LlmRouterService } from './services/llm-router.service';
import { MinimaxService } from './services/minimax.service';
import { OllamaService } from './services/ollama.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { RegenerateService } from './services/regenerate.service';
import { TaskExtractionService } from './services/task-extraction.service';
import { VoxService } from './services/vox.service';

/**
 * Корневой модуль worker-процесса (`workers/main.ts`).
 *
 * Включает только то, что нужно воркерам — без HTTP-контроллеров и guards.
 * Зависимости:
 *   - инфра: Config, Logger, Prisma, Redis, Metrics.
 *   - бизнес-сервисы: MeetingsService (FSM-переходы), S3Service.
 *   - AI-клиенты: Vox, Anthropic, MiniMax, OpenAiProxy, LlmFallback.
 *   - очереди: AiQueueService (для cross-stage enqueue).
 *   - воркеры: 4 шт.
 *
 * `MeetingsService` тащит за собой `LivekitService` и `JwtService` через
 * конструктор — добавляем их как локальные провайдеры (без контроллеров).
 * `RecordingsService` нужен только потому, что `WebhooksModule` его инжектит,
 * но воркер сам по себе вебхуки не обрабатывает — поэтому RecordingsService
 * НЕ включаем (а MeetingsService его не требует напрямую).
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    MetricsModule,
    // ScheduleModule нужен для @Cron в LlmRouterService (refresh кэша routes).
    ScheduleModule.forRoot(),
    // EmbeddingsModule приносит EmbeddingFallback + TranscriptIndexer
    // — используются TranscriptIndexWorker'ом и (опц.) другими сервисами M3c.
    EmbeddingsModule,
    // knowledge-core (Фаза 2) — services для block-ingest/distill воркеров.
    KnowledgeCoreModule,
  ],
  providers: [
    // бизнес — нужны для FSM-переходов.
    MeetingsService,
    MeetingsRepository,
    UsersService,
    UsersRepository,
    JwtService,
    // S3 — для скачивания audio из S3 и записи transcripts/*.
    S3Service,
    // AI-клиенты.
    VoxService,
    AnthropicService,
    MinimaxService,
    OpenAiProxyService,
    DeepSeekService,
    OllamaService,
    LlmFallbackService,
    AiUsageLogService,
    AiQueueService,
    // knowledge-core (Фаза 1) — для AnalyzeWorker.
    CoreQueueService,
    IngestService,
    MeetingIngestAdapter,
    // M3 AI-pipeline расширения.
    LlmRouterService,
    ChapterExtractionService,
    TaskExtractionService,
    RegenerateService,
    CardRollupService,
    // Воркеры.
    TranscribeWorker,
    MergeWorker,
    AnalyzeWorker,
    NotifyWorker,
    ChaptersWorker,
    TasksExtractWorker,
    TranscriptIndexWorker,
    ClipRenderWorker,
    CardRollupWorker,
    // knowledge-core (Фаза 2) — воркеры block-ingest и block-distill.
    BlockIngestWorker,
    BlockDistillWorker,
    // knowledge-core (Фаза 2 Шаг 4) — entity-resolver: cron + on-event worker.
    EntityResolverWorker,
    EntityResolverCronService,
    // knowledge-core (Фаза 3) — block-linker: типизированные связи блоков.
    BlockLinkerWorker,
  ],
})
export class WorkersModule {}
