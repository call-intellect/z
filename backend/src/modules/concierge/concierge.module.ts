import { Module } from '@nestjs/common';

import { ConciergeController } from './concierge.controller';
import { AssistantChannelBridge } from './services/assistant-channel.bridge';
import { ConciergeContextBuilderService } from './services/concierge-context-builder.service';
import { ConciergeQuotaService } from './services/concierge-quota.service';
import { ConciergeUndoLogService } from './services/concierge-undo-log.service';
import { ConciergeService } from './services/concierge.service';
import { ServiceMapGeneratorService } from './services/service-map-generator.service';
import { ConciergeStepScorerService } from './services/step-scorer.service';
import { ToolRouterService } from './services/tool-router.service';
import { ConciergeConversationSummarizerCron } from './workers/concierge-conversation-summarizer.cron';
import { ConciergeQuotaResetCron } from './workers/concierge-quota-reset.cron';

/**
 * SBA γ-2 — ConciergeModule.
 *
 * Зависимости (через @Global):
 *   - PrismaService, TypedConfigService, BusinessMetricsService, RedisService.
 *   - LlmRouterService (AiModule, @Global) — tool-use loop.
 *   - RbacService (RbacModule, @Global) — проверка permissions.
 *
 * Регистрирует REST API /api/v1/concierge/* (SSE + polling + conversations +
 * undo + quota) + 3 cron'а (daily/monthly quota reset, conversation summarizer).
 *
 * См. plans/tz/2026-05-23-sba-gamma-2-concierge-agent.md §5.
 */
@Module({
  controllers: [ConciergeController],
  providers: [
    ConciergeService,
    ToolRouterService,
    ServiceMapGeneratorService,
    ConciergeContextBuilderService,
    ConciergeUndoLogService,
    ConciergeQuotaService,
    ConciergeStepScorerService,
    ConciergeQuotaResetCron,
    ConciergeConversationSummarizerCron,
    // Ф5 assistant-channels (2026-06-11) — мост «Telegram/MAX → помощник»:
    // подписка на inbound assistant_turn в onModuleInit (паттерн
    // ChatV2OmnichannelBridge). ConversationalService и RedisService — из
    // @Global модулей, импорт не нужен (циклической зависимости нет).
    AssistantChannelBridge,
  ],
  exports: [
    ConciergeService,
    ConciergeQuotaService,
    ConciergeStepScorerService,
  ],
})
export class ConciergeModule {}
