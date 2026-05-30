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
import { GrsaiService } from './services/grsai.service';
import { KieService } from './services/kie.service';
import { LlmRouterService } from './services/llm-router.service';
import { MinimaxService } from './services/minimax.service';
import { MultiAgentDebateService } from './services/multi-agent-debate.service';
import { OllamaService } from './services/ollama.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { ParticipantContextService } from './services/participant-context.service';
import { PromptResolverService } from './services/prompt-resolver.service';
import { AnthropicMessagesProtocolAdapter } from './services/protocol-adapter/adapters/anthropic-messages.adapter';
import { CustomHttpProtocolAdapter } from './services/protocol-adapter/adapters/custom-http.adapter';
import { OllamaNativeProtocolAdapter } from './services/protocol-adapter/adapters/ollama-native.adapter';
import { OpenAiChatProtocolAdapter } from './services/protocol-adapter/adapters/openai-chat.adapter';
import { OpenAiResponsesProtocolAdapter } from './services/protocol-adapter/adapters/openai-responses.adapter';
import { LlmProtocolAdapterRegistry } from './services/protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from './services/protocol-adapter/provider-info.resolver';
import { RegenerateService } from './services/regenerate.service';
import { RetryService } from './services/retry.service';
import { TaskExtractionService } from './services/task-extraction.service';
import { TranscriptCleanLlmRefineService } from './services/transcript-clean-llm-refine.service';
import { TranscriptCleaningService } from './services/transcript-cleaning.service';
import { VoxService } from './services/vox.service';

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
    // KIE (api.kie.ai — Claude/GPT/Gemini) и GRSAI (Gemini через прокси) —
    // подключены к LlmRouter; модели становятся доступны в /admin/ai-models.
    // ТЗ: plans/tz/2026-05-24-kie-grsai-llm-router-integration.md.
    KieService,
    GrsaiService,
    // Маршрутизация и регенерация.
    LlmRouterService,
    // Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate.
    // Используется Specialist33Service.supersedeDetect под флагом
    // MULTI_AGENT_DEBATE_ENABLED. Optional-injection — на воркер-side и в
    // тестах сервис может отсутствовать без падения DI.
    MultiAgentDebateService,
    // SBA α-10 wave 3 — LlmProtocolAdapterRegistry (feature-flag через
    // USE_PROTOCOL_ADAPTER_REGISTRY). Все 5 адаптеров регистрируем сразу —
    // включение/выключение управляется feature-flag в LlmRouterService.dispatch().
    OpenAiChatProtocolAdapter,
    OpenAiResponsesProtocolAdapter,
    AnthropicMessagesProtocolAdapter,
    OllamaNativeProtocolAdapter,
    CustomHttpProtocolAdapter,
    LlmProtocolAdapterRegistry,
    ProviderInfoResolver,
    ChapterExtractionService,
    TaskExtractionService,
    // ТЗ 2026-05-25 hard-participant-identification — загрузка списка
    // участников встречи (с userId/fullName) для AI-промптов задач.
    ParticipantContextService,
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
    // SBA β-1 zero-button (2026-05-23): VoxService поднят в @Global AiModule,
    // чтобы HTTP-side адаптеры Telegram/MAX могли инжектить ASR для voice
    // inbound. Раньше VoxService жил только в WorkersModule (см.
    // ai/workers.module.ts).
    VoxService,
    // S3 — нужен RegenerateService (для regenerate-section читает merged).
    S3Service,
  ],
  exports: [
    AiQueueService,
    AiUsageLogService,
    RetryService,
    LlmRouterService,
    MultiAgentDebateService,
    RegenerateService,
    ChapterExtractionService,
    TaskExtractionService,
    ParticipantContextService,
    CardRollupService,
    PromptResolverService,
    BehaviorMetricsCalculator,
    BehaviorLlmRefineService,
    TranscriptCleanLlmRefineService,
    TranscriptCleaningService,
    VoxService,
    EmbeddingsModule,
    // SBA α-10 wave 3 — нужны admin/economics-модулю для smoke-теста и
    // direct dispatch без LlmRouter.
    LlmProtocolAdapterRegistry,
    ProviderInfoResolver,
  ],
})
export class AiModule {}
