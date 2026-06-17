import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';
import { IdeasModule } from '../ideas/ideas.module';
import { PendingActionsModule } from '../pending-actions/pending-actions.module';
import { ProbeModule } from '../probe/probe.module';
import { TrackerModule } from '../tracker/tracker.module';

import { DailyDigestController } from './controllers/daily-digest.controller';
import { MyCheckInsController } from './controllers/my-check-ins.controller';
import { MyCustomerRiskController } from './controllers/my-customer-risk.controller';
import { MyDailyBriefController } from './controllers/my-daily-brief.controller';
import { MyDailyValueController } from './controllers/my-daily-value.controller';
import { MyPromisesController } from './controllers/my-promises.controller';
import { MyWeeklyPerPersonController } from './controllers/my-weekly-per-person.controller';
import { OperationsDashboardController } from './controllers/operations-dashboard.controller';
import { PersonalRelationsController } from './controllers/personal-relations.controller';
import { WeeklyDigestController } from './controllers/weekly-digest.controller';
import { WeeklyPerPersonController } from './controllers/weekly-per-person.controller';
import { BlockerSynthesisService } from './services/blocker-synthesis.service';
import { CheckinIngestService } from './services/checkin-ingest.service';
import { CheckinParserService } from './services/checkin-parser.service';
import { CheckinResponseHandler } from './services/checkin-response.handler';
import { DecisionImplementationService } from './services/decision-implementation.service';
import { KnowledgeAtRiskService } from './services/knowledge-at-risk.service';
import { OnboardingRampService } from './services/onboarding-ramp.service';
import { TeamCapacityService } from './services/team-capacity.service';
import { PromiseCascadeService } from './services/promise-cascade.service';
import { CommitmentResponseHandler } from './services/commitment-response.handler';
import { CommitmentsService } from './services/commitments.service';
import { CustomerRiskRadarService } from './services/customer-risk-radar.service';
import { DailyCheckInService } from './services/daily-checkin.service';
import { KnowsWhoService } from './services/knows-who.service';
import { PersonalDailyBriefService } from './services/personal-daily-brief.service';
import { DailyDigestService } from './services/daily-digest.service';
import { GoalCascadeService } from './services/goal-cascade.service';
import { OperationsDashboardService } from './services/operations-dashboard.service';
import { PersonalRelationService } from './services/personal-relation.service';
import { PortfolioHealthService } from './services/portfolio-health.service';
import { PromiseNetworkService } from './services/promise-network.service';
import { Specialist39PromiseKeeperService } from './services/specialist-3-9-promise-keeper.service';
import { ValueRecapService } from './services/value-recap.service';
import { WeeklyDigestService } from './services/weekly-digest.service';
import { WeeklyPerPersonService } from './services/weekly-per-person.service';
import { BlockerSynthesisCron } from './workers/blocker-synthesis.cron';
import { ChannelBindingCampaignCron } from './workers/channel-binding-campaign.cron';
import { CheckinGraphIngestListener } from './workers/checkin-graph-ingest.listener';
import { CheckinSentimentAnalyzerWorker } from './workers/checkin-sentiment-analyzer.worker';
import { CustomerRiskRadarCron } from './workers/customer-risk-radar.cron';
import { DecisionImplementationCron } from './workers/decision-implementation.cron';
import { ExecMorningPushCron } from './workers/exec-morning-push.cron';
import { KnowledgeAtRiskCron } from './workers/knowledge-at-risk.cron';
import { OnboardingRampCron } from './workers/onboarding-ramp.cron';
import { PromiseCascadeCron } from './workers/promise-cascade.cron';
import { PersonalDailyBriefCron } from './workers/personal-daily-brief.cron';
import { CheckinSentimentBatchCron } from './workers/checkin-sentiment-batch.cron';
import { CommitmentFollowupCron } from './workers/commitment-followup.cron';
import { DailyCheckInPromptCron } from './workers/daily-checkin-prompt.cron';
import { OperationsDailyDigestCron } from './workers/operations-daily-digest.cron';
import { OperationsWeeklyDigestCron } from './workers/operations-weekly-digest.cron';
import { CheckInConflictDetectorCron } from './workers/personal-relation-builder.worker';
import { PortfolioHealthSnapshotCron } from './workers/portfolio-health-snapshot.cron';
import { ReflectionQualityScorerCron } from './workers/reflection-quality-scorer.cron';
import { ValueRecapCron } from './workers/value-recap.cron';

@Module({
  imports: [
    PrismaModule,
    ProbeModule,
    TrackerModule,
    PendingActionsModule,
    ChatV2Module,
    IdeasModule,
  ],
  controllers: [
    OperationsDashboardController,
    MyCheckInsController,
    PersonalRelationsController,
    WeeklyDigestController,
    WeeklyPerPersonController,
    MyPromisesController,
    DailyDigestController,
    MyCustomerRiskController,
    MyDailyBriefController,
    MyWeeklyPerPersonController,
    MyDailyValueController,
  ],
  providers: [
    DailyCheckInService,
    OperationsDashboardService,
    PersonalRelationService,
    GoalCascadeService,
    CheckinParserService,
    CheckinResponseHandler,
    CheckinIngestService,
    CheckinGraphIngestListener,
    DailyCheckInPromptCron,
    WeeklyDigestService,
    WeeklyPerPersonService,
    OperationsWeeklyDigestCron,
    CheckinSentimentAnalyzerWorker,
    CheckinSentimentBatchCron,
    CommitmentsService,
    Specialist39PromiseKeeperService,
    CommitmentFollowupCron,
    CommitmentResponseHandler,
    DailyDigestService,
    OperationsDailyDigestCron,
    ReflectionQualityScorerCron,
    CheckInConflictDetectorCron,
    ChannelBindingCampaignCron,
    CustomerRiskRadarService,
    CustomerRiskRadarCron,
    PersonalDailyBriefService,
    KnowsWhoService,
    PersonalDailyBriefCron,
    ExecMorningPushCron,
    BlockerSynthesisService,
    BlockerSynthesisCron,
    DecisionImplementationService,
    DecisionImplementationCron,
    PromiseCascadeService,
    PromiseCascadeCron,
    KnowledgeAtRiskService,
    KnowledgeAtRiskCron,
    TeamCapacityService,
    OnboardingRampService,
    OnboardingRampCron,
    ValueRecapService,
    ValueRecapCron,
    PortfolioHealthService,
    PortfolioHealthSnapshotCron,
    // ТЗ coo-orphan-agents Ф7 — перегруз ответственностью: read-сервис над
    // последним PromiseNetworkSnapshot (accumulators). Endpoint
    // /dashboard/operations/promise-network. Снапшот пишет PromiseNetworkAnalyzerCron.
    PromiseNetworkService,
  ],
  exports: [
    GoalCascadeService,
    DailyCheckInService,
    OperationsDashboardService,
    PersonalRelationService,
    CheckinParserService,
    WeeklyDigestService,
    CommitmentsService,
    Specialist39PromiseKeeperService,
    DailyDigestService,
    CustomerRiskRadarService,
    PersonalDailyBriefService,
    KnowsWhoService,
    BlockerSynthesisService,
    DecisionImplementationService,
    PromiseCascadeService,
    KnowledgeAtRiskService,
    TeamCapacityService,
    OnboardingRampService,
    ValueRecapService,
    PortfolioHealthService,
    // ТЗ coo-orphan-agents Ф7 — экспортируем для тестов / reuse.
    PromiseNetworkService,
  ],
})
export class OperationsModule {}
