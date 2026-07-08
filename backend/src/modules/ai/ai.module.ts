import { Global, Module } from '@nestjs/common';

import { CurrencyRateModule } from '../admin/economics/currency-rate.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { S3Service } from '../recordings/s3.service';

import { AiQueueService } from './ai-queue.service';
import { AiUsageLogCleanupService } from './services/ai-usage-log-cleanup.service';
import { AiUsageLogService } from './services/ai-usage-log.service';
import { AnthropicService } from './services/anthropic.service';
import { BehaviorLlmRefineService } from './services/behavior-llm-refine';
import { BehaviorMetricsCalculator } from './services/behavior-metrics-calculator';
import { BudgetGuardService } from './services/budget-guard.service';
import { CardRollupService } from './services/card-rollup.service';
import { CompanyCapsuleService } from './services/company-capsule.service';
import { DeepSeekService } from './services/deepseek.service';
import { GrsaiService } from './services/grsai.service';
import { KieService } from './services/kie.service';
import { LlmRouterService } from './services/llm-router.service';
import { MinimaxService } from './services/minimax.service';
import { MultiAgentDebateService } from './services/multi-agent-debate.service';
import { OllamaService } from './services/ollama.service';
import { OpenAiProxyService } from './services/openai-proxy.service';
import { OrgContextService } from './services/org-context.service';
import { ParticipantContextService } from './services/participant-context.service';
import { PromptResolverService } from './services/prompt-resolver.service';
import { AnthropicMessagesProtocolAdapter } from './services/protocol-adapter/adapters/anthropic-messages.adapter';
import { CustomHttpProtocolAdapter } from './services/protocol-adapter/adapters/custom-http.adapter';
import { GrsaiProtocolAdapter } from './services/protocol-adapter/adapters/grsai-native.adapter';
import { KieProtocolAdapter } from './services/protocol-adapter/adapters/kie-native.adapter';
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

@Global()
@Module({
  imports: [EmbeddingsModule, CurrencyRateModule],
  providers: [
    AiQueueService,
    AiUsageLogService,
    AiUsageLogCleanupService,
    RetryService,
    AnthropicService,
    MinimaxService,
    OpenAiProxyService,
    DeepSeekService,
    OllamaService,
    KieService,
    GrsaiService,
    LlmRouterService,
    BudgetGuardService,
    MultiAgentDebateService,
    OpenAiChatProtocolAdapter,
    OpenAiResponsesProtocolAdapter,
    AnthropicMessagesProtocolAdapter,
    OllamaNativeProtocolAdapter,
    KieProtocolAdapter,
    GrsaiProtocolAdapter,
    CustomHttpProtocolAdapter,
    LlmProtocolAdapterRegistry,
    ProviderInfoResolver,
    TaskExtractionService,
    ParticipantContextService,
    OrgContextService,
    CompanyCapsuleService,
    RegenerateService,
    CardRollupService,
    PromptResolverService,
    BehaviorMetricsCalculator,
    BehaviorLlmRefineService,
    TranscriptCleanLlmRefineService,
    TranscriptCleaningService,
    VoxService,
    S3Service,
  ],
  exports: [
    AiQueueService,
    AiUsageLogService,
    RetryService,
    LlmRouterService,
    MultiAgentDebateService,
    RegenerateService,
    TaskExtractionService,
    ParticipantContextService,
    OrgContextService,
    CompanyCapsuleService,
    CardRollupService,
    PromptResolverService,
    BehaviorMetricsCalculator,
    BehaviorLlmRefineService,
    TranscriptCleanLlmRefineService,
    TranscriptCleaningService,
    VoxService,
    EmbeddingsModule,
    LlmProtocolAdapterRegistry,
    ProviderInfoResolver,
  ],
})
export class AiModule {}
