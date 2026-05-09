import { Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { LoggerModule } from '../../common/logger/logger.module';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { S3Service } from '../recordings/s3.service';
import { JwtService } from '../auth/services/jwt.service';
import { UsersService } from '../users/users.service';
import { UsersRepository } from '../users/users.repository';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { MeetingsService } from '../meetings/meetings.service';

import { AiQueueService } from './ai-queue.service';
import { AnalyzeWorker } from './workers/analyze.worker';
import { MergeWorker } from './workers/merge.worker';
import { NotifyWorker } from './workers/notify.worker';
import { TranscribeWorker } from './workers/transcribe.worker';
import { AiUsageLogService } from './services/ai-usage-log.service';
import { AnthropicService } from './services/anthropic.service';
import { LlmFallbackService } from './services/llm-fallback.service';
import { MinimaxService } from './services/minimax.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
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
    LlmFallbackService,
    AiUsageLogService,
    AiQueueService,
    // Воркеры.
    TranscribeWorker,
    MergeWorker,
    AnalyzeWorker,
    NotifyWorker,
  ],
})
export class WorkersModule {}
