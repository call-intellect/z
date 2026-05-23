import { Module } from '@nestjs/common';

import { ConciergeController } from './concierge.controller';
import { ConciergeContextBuilderService } from './services/concierge-context-builder.service';
import { ConciergeQuotaService } from './services/concierge-quota.service';
import { ConciergeService } from './services/concierge.service';
import { ConciergeUndoLogService } from './services/concierge-undo-log.service';
import { ServiceMapGeneratorService } from './services/service-map-generator.service';
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
    ConciergeQuotaResetCron,
    ConciergeConversationSummarizerCron,
  ],
  exports: [ConciergeService, ConciergeQuotaService],
})
export class ConciergeModule {}
