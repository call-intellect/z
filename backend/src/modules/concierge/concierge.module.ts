import { Module } from '@nestjs/common';

import { ChatV2Module } from '../chat-v2/chat-v2.module';

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

@Module({
  imports: [ChatV2Module],
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
    AssistantChannelBridge,
  ],
  exports: [ConciergeService, ConciergeQuotaService, ConciergeStepScorerService],
})
export class ConciergeModule {}
