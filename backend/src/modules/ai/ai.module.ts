import { Global, Module } from '@nestjs/common';

import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { S3Service } from '../recordings/s3.service';

import { AiQueueService } from './ai-queue.service';
import { AiUsageLogService } from './services/ai-usage-log.service';
import { AnthropicService } from './services/anthropic.service';
import { BehaviorLlmRefineService } from './services/behavior-llm-refine';
import { BehaviorMetricsCalculator } from './services/behavior-metrics-calculator';
import { CardRollupService } from './services/card-rollup.service';
import { ChapterExtractionService } from './services/chapter-extraction.service';
import { DeepSeekService } from './services/deepseek.service';
import { LlmRouterService } from './services/llm-router.service';
import { MinimaxService } from './services/minimax.service';
import { OllamaService } from './services/ollama.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { PromptResolverService } from './services/prompt-resolver.service';
import { RegenerateService } from './services/regenerate.service';
import { RetryService } from './services/retry.service';
import { TaskExtractionService } from './services/task-extraction.service';
import { TranscriptCleanLlmRefineService } from './services/transcript-clean-llm-refine.service';
import { TranscriptCleaningService } from './services/transcript-cleaning.service';

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
    DeepSeekService,
    OllamaService,
    // Маршрутизация и регенерация.
    LlmRouterService,
    ChapterExtractionService,
    TaskExtractionService,
    RegenerateService,
    // Card-rollup — синхронный вызов из endpoint'а на странице карточки
    // (опционально), и из воркера (см. WorkersModule).
    CardRollupService,
    // Фаза A.1 — резолв промптов AI-отчёта (БД → code fallback).
    PromptResolverService,
    // Фаза B — поведенческие метрики (calculator pure-функция + опц. LLM-refine).
    BehaviorMetricsCalculator,
    BehaviorLlmRefineService,
    // Фаза D — очистка транскрипта (LLM-refine + HTTP-side service для endpoints).
    TranscriptCleanLlmRefineService,
    TranscriptCleaningService,
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
    PromptResolverService,
    BehaviorMetricsCalculator,
    BehaviorLlmRefineService,
    TranscriptCleanLlmRefineService,
    TranscriptCleaningService,
    EmbeddingsModule,
  ],
})
export class AiModule {}
