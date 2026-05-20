import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';

import { AiUsageLogService } from './services/ai-usage-log.service';
import { AnthropicService } from './services/anthropic.service';
import { DeepSeekService } from './services/deepseek.service';
import { LlmRouterService } from './services/llm-router.service';
import { MinimaxService } from './services/minimax.service';
import { OllamaService } from './services/ollama.service';
import { OpenAiProxyService } from './services/openai-proxy.service';

/**
 * @Global-обёртка над LlmRouterService для worker-процесса.
 *
 * На HTTP-side LlmRouterService приходит из @Global `AiModule`. В worker-процессе
 * `AiModule` целиком импортировать нельзя — он тащит `RetryService` → `MeetingsService`,
 * которых нет в его scope. Поэтому здесь узкий @Global модуль ровно с LlmRouterService
 * и его LLM-клиентами, чтобы @Global `KnowledgeCoreModule` (block-extraction,
 * entity-resolution, v2-агенты) и AI-сервисы воркера видели LlmRouterService.
 * Prisma/TypedConfig/BusinessMetrics(@Optional) — глобальные.
 *
 * Импортируется ТОЛЬКО в `WorkersModule` (на HTTP не используется).
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    AnthropicService,
    MinimaxService,
    OpenAiProxyService,
    DeepSeekService,
    OllamaService,
    AiUsageLogService,
    LlmRouterService,
  ],
  exports: [
    LlmRouterService,
    AnthropicService,
    MinimaxService,
    OpenAiProxyService,
    DeepSeekService,
    OllamaService,
    AiUsageLogService,
  ],
})
export class LlmRouterGlobalModule {}
