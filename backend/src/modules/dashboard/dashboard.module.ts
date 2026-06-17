import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';
import { PendingActionsModule } from '../pending-actions/pending-actions.module';

import { BurnoutRiskDetectorCron } from './agents/burnout-risk-detector.cron';
import { BusFactorAnalyzerCron } from './agents/bus-factor-analyzer.cron';
import { DecisionHygieneScorerWorker } from './agents/decision-hygiene-scorer.worker';
import { EngagementScorerCron } from './agents/engagement-scorer.cron';
import { ForecasterCron } from './agents/forecaster.cron';
import { GoalVectorTrackerCron } from './agents/goal-vector-tracker.cron';
import { HrRecommenderCron } from './agents/hr-recommender.cron';
import { KnowledgeVelocityTrackerCron } from './agents/knowledge-velocity-tracker.cron';
import { MeetingRoiScorerWorker } from './agents/meeting-roi-scorer.worker';
import { PromiseNetworkAnalyzerCron } from './agents/promise-network-analyzer.cron';
import { TeamHealthAnalyzerCron } from './agents/team-health-analyzer.cron';
import { ThemeSilenceDetectorCron } from './agents/theme-silence-detector.cron';
import { TopicRecurrenceDetectorCron } from './agents/topic-recurrence-detector.cron';
import { DirectorDashboardController } from './director-dashboard.controller';
import { CommitmentReliabilityService } from './services/commitment-reliability.service';
import { DashboardQueueService } from './services/dashboard-queue.service';
import { DirectorDashboardService } from './services/director-dashboard.service';
import { HangingDecisionsService } from './services/hanging-decisions.service';
import { NarrativeCitationsParserService } from './services/narrative-citations-parser.service';
import { PeopleAtRiskService } from './services/people-at-risk.service';
import { PulsePatternsService } from './services/pulse-patterns.service';
import { SentimentIndexService } from './services/sentiment-index.service';
import { TeamDetailService } from './services/team-detail.service';
import { TeamHealthService } from './services/team-health.service';

@Module({
  imports: [PrismaModule, OperationsModule, PendingActionsModule],
  controllers: [DirectorDashboardController],
  providers: [
    DirectorDashboardService,
    CommitmentReliabilityService,
    HangingDecisionsService,
    SentimentIndexService,
    NarrativeCitationsParserService,
    TeamHealthService,
    TeamDetailService,
    PulsePatternsService,
    PeopleAtRiskService,
    TeamHealthAnalyzerCron,
    EngagementScorerCron,
    HrRecommenderCron,
    BurnoutRiskDetectorCron,
    ForecasterCron,
    BusFactorAnalyzerCron,
    TopicRecurrenceDetectorCron,
    ThemeSilenceDetectorCron,
    PromiseNetworkAnalyzerCron,
    GoalVectorTrackerCron,
    KnowledgeVelocityTrackerCron,
    DashboardQueueService,
    MeetingRoiScorerWorker,
    DecisionHygieneScorerWorker,
  ],
  exports: [
    CommitmentReliabilityService,
    HangingDecisionsService,
    SentimentIndexService,
    TeamHealthService,
    TeamDetailService,
    PulsePatternsService,
    DashboardQueueService,
  ],
})
export class DashboardModule {}
