import { Module } from '@nestjs/common';

import { ConciergeAnalyticsController } from './concierge-analytics.controller';
import { ConciergeAnalyticsService } from './concierge-analytics.service';
import { KnowledgeAnalyticsController } from './knowledge-analytics.controller';
import { KnowledgeAnalyticsService } from './knowledge-analytics.service';

@Module({
  controllers: [KnowledgeAnalyticsController, ConciergeAnalyticsController],
  providers: [KnowledgeAnalyticsService, ConciergeAnalyticsService],
  exports: [KnowledgeAnalyticsService, ConciergeAnalyticsService],
})
export class AnalyticsModule {}
