import { Global, Module } from '@nestjs/common';

import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { S3Service } from '../recordings/s3.service';

import { AiQueueService } from './ai-queue.service';
import { AiUsageLogService } from './services/ai-usage-log.service';
import { AnthropicService } from './services/anthropic.service';
import { CardRollupService } from './services/card-rollup.service';
import { ChapterExtractionService } from './services/chapter-extraction.service';
import { LlmRouterService } from './services/llm-router.service';
import { MinimaxService } from './services/minimax.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { RegenerateService } from './services/regenerate.service';
import { RetryService } from './services/retry.service';
import { TaskExtractionService } from './services/task-extraction.service';

/**
 * Глобальный AI-модуль для HTTP-процесса.
 *
 *   - `AiQueueService` — диспетчер очередей (webhook handler, `RetryService`,
 *      `RegenerateService`).
 *   - `AiUsageLogService` — пишет AiUsageLog.
 *   - `RetryService` — endpoint `POST /api/v1/meetings/:id/retry-ai`.
 *   - `LlmRouterService` — маршрутизатор LLM-задач (используется
 *      `RegenerateService`, и эндпоинтами M3 — chat / regenerate-section).
 *   - `RegenerateService` — endpoint `POST /api/v1/meetings/:id/regenerate*`.
 *   - `ChapterExtractionService` / `TaskExtractionService` — на случай
 *      синхронного вызова из admin / debug.
 *
 * Воркеры (transcribe/merge/analyze/notify/chapters/tasks-extract/
 * transcript-index/clip-render) живут в отдельном `WorkersModule`,
 * запускаются процессом `bun run worker:dev` (`workers/main.ts`).
 *
 * EmbeddingsModule импортируется здесь, чтобы EmbeddingFallback /
 * TranscriptIndexer были доступны в HTTP-side (например, для on-demand
 * переиндексации из админки).
 */
@Global()
@Module({
  imports: [EmbeddingsModule],
  providers: [
    AiQueueService,
    AiUsageLogService,
    RetryService,
    // Провайдеры — нужны для LlmRouter в HTTP-side.
    AnthropicService,
    MinimaxService,
    OpenAiProxyService,
    // Маршрутизация и регенерация.
    LlmRouterService,
    ChapterExtractionService,
    TaskExtractionService,
    RegenerateService,
    // Card-rollup — синхронный вызов из endpoint'а на странице карточки
    // (опционально), и из воркера (см. WorkersModule).
    CardRollupService,
    // S3 — нужен RegenerateService (для regenerate-section читает merged).
    S3Service,
  ],
  exports: [
    AiQueueService,
    AiUsageLogService,
    RetryService,
    LlmRouterService,
    RegenerateService,
    ChapterExtractionService,
    TaskExtractionService,
    CardRollupService,
    EmbeddingsModule,
  ],
})
export class AiModule {}
