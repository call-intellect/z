import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { ConfigModule } from '../../common/config/index';
import { LoggerModule } from '../../common/logger/logger.module';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { CoreQueueModule } from '../core-queue/core-queue.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { EntitlementGlobalModule } from '../entitlements/entitlement-global.module';
import { QuotasModule } from '../quotas/quotas.module';
import { MeetingIngestAdapter } from '../ingest/adapters/meeting.adapter';
import { IngestService } from '../ingest/ingest.service';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module';
import { BlockDistillWorker } from '../knowledge-core/workers/block-distill.worker';
import { BlockIngestWorker } from '../knowledge-core/workers/block-ingest.worker';
import { BlockLinkerWorker } from '../knowledge-core/workers/block-linker.worker';
import { CardRollupV2Worker } from '../knowledge-core/workers/card-rollup-v2.worker';
import { EntityGraphBuilderCron } from '../knowledge-core/workers/entity-graph-builder.cron';
import { EntityResolverCronService } from '../knowledge-core/workers/entity-resolver.cron';
import { EntityResolverWorker } from '../knowledge-core/workers/entity-resolver.worker';
import { MeetingAnalyzeV2Cron } from '../knowledge-core/workers/meeting-analyze-v2.cron';
import { MeetingAnalyzeV2Worker } from '../knowledge-core/workers/meeting-analyze-v2.worker';
import { ReframingCron } from '../knowledge-core/workers/reframing.cron';
import { StrategicAlignmentCron } from '../knowledge-core/workers/strategic-alignment.cron';
import { StrategicAlignmentWorker } from '../knowledge-core/workers/strategic-alignment.worker';
import { ThemeClustererCron } from '../knowledge-core/workers/theme-clusterer.cron';
import { S3Service } from '../recordings/s3.service';
import { JwtService } from '../auth/services/jwt.service';
import { UsersService } from '../users/users.service';
import { UsersRepository } from '../users/users.repository';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { MeetingsService } from '../meetings/meetings.service';

import { AiQueueService } from './ai-queue.service';
import { LlmRouterGlobalModule } from './llm-router-global.module';
import { AnalyzeWorker } from './workers/analyze.worker';
import { CardRollupWorker } from './workers/card-rollup.worker';
import { ChaptersWorker } from './workers/chapters.worker';
import { ClipRenderWorker } from './workers/clip-render.worker';
import { MergeWorker } from './workers/merge.worker';
import { NotifyWorker } from './workers/notify.worker';
import { TasksExtractWorker } from './workers/tasks-extract.worker';
import { TranscribeWorker } from './workers/transcribe.worker';
import { TranscriptIndexWorker } from './workers/transcript-index.worker';
import { CardRollupService } from './services/card-rollup.service';
import { ChapterExtractionService } from './services/chapter-extraction.service';
import { LlmFallbackService } from './services/llm-fallback.service';
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
    // Phase 9: AuditLogService нужен strategic-alignment воркеру/cron'у.
    AuditModule,
    // @Global-обёртки/модули для NestJS 11 (строгий DI): делают видимыми для
    // @Global KnowledgeCoreModule и локальных провайдеров воркера сервисы, которые
    // на HTTP даёт @Global AiModule. LlmRouterGlobalModule — LlmRouter + LLM-клиенты;
    // EntitlementGlobalModule — EntitlementService (без HTTP-контроллера);
    // CoreQueueModule — CoreQueueService/WorkerOrgGate; QuotasModule — QuotaService.
    LlmRouterGlobalModule,
    EntitlementGlobalModule,
    CoreQueueModule,
    QuotasModule,
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
    // AI-клиенты. Anthropic/Minimax/OpenAiProxy/DeepSeek/Ollama/AiUsageLog/LlmRouter
    // — из @Global LlmRouterGlobalModule. CoreQueueService/WorkerOrgGate — из
    // @Global CoreQueueModule. EntitlementService/QuotaService — из их @Global модулей.
    VoxService,
    LlmFallbackService,
    AiQueueService,
    IngestService,
    MeetingIngestAdapter,
    // M3 AI-pipeline расширения (LlmRouterService — из LlmRouterGlobalModule).
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
    // knowledge-core (Фаза 3) — entity-graph-builder: связи сущностей (раз в час).
    EntityGraphBuilderCron,
    // knowledge-core (Фаза 3) — reframing: ночное переосмысление графа (3:00).
    ReframingCron,
    // knowledge-core (Фаза 4) — theme-clusterer: KNN-greedy + LLM theme-classify.
    ThemeClustererCron,
    // knowledge-core (Фаза 4) — card-rollup-v2: rollup поверх IdeaBlock'ов.
    CardRollupV2Worker,
    // knowledge-core (Фаза 5) — meeting-analyze-v2: Tasks-2.0/Chapters-2.0/Summary-2.0
    // поверх IdeaBlock'ов встречи. Параллельно legacy (не вместо).
    MeetingAnalyzeV2Worker,
    MeetingAnalyzeV2Cron,
    // knowledge-core (Фаза 9) — strategic-alignment: суточная LLM-оценка
    // движения к Goal (cron 04:00 + ручной recompute через очередь).
    StrategicAlignmentWorker,
    StrategicAlignmentCron,
  ],
})
export class WorkersModule {}
