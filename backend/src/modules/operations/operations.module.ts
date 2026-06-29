import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';
import { IdeasModule } from '../ideas/ideas.module';
import { PendingActionsModule } from '../pending-actions/pending-actions.module';
import { ProbeModule } from '../probe/probe.module';
import { TrackerModule } from '../tracker/tracker.module';

import { DailyDigestController } from './controllers/daily-digest.controller';
import { MonthlyDigestController } from './controllers/monthly-digest.controller';
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
import { CheckinExpectationService } from './services/checkin-expectation.service';
import { CheckinIngestService } from './services/checkin-ingest.service';
import { CheckinParserService } from './services/checkin-parser.service';
import { CheckinResponseHandler } from './services/checkin-response.handler';
import { ClosureVerifierService } from './services/closure-verifier.service';
import { CommitmentsService } from './services/commitments.service';
import { CustomerRiskRadarService } from './services/customer-risk-radar.service';
import { DailyCheckInService } from './services/daily-checkin.service';
import { DailyDigestService } from './services/daily-digest.service';
import { DayReportCollectorService } from './services/day-report-collector.service';
import { DecisionImplementationService } from './services/decision-implementation.service';
import { GoalCascadeService } from './services/goal-cascade.service';
import { KnowledgeAtRiskService } from './services/knowledge-at-risk.service';
import { KnowsWhoService } from './services/knows-who.service';
import { MonthlyDigestService } from './services/monthly-digest.service';
import { OnboardingRampService } from './services/onboarding-ramp.service';
import { OperationsDashboardService } from './services/operations-dashboard.service';
import { PersonalDailyBriefService } from './services/personal-daily-brief.service';
import { PersonalRelationService } from './services/personal-relation.service';
import { PortfolioHealthService } from './services/portfolio-health.service';
import { PromiseCascadeService } from './services/promise-cascade.service';
import { PromiseNetworkService } from './services/promise-network.service';
import { TaskCompletionHandler } from './services/task-completion.handler';
import { TaskReconcileService } from './services/task-reconcile.service';
import { TeamCapacityService } from './services/team-capacity.service';
import { ValueRecapService } from './services/value-recap.service';
import { WeeklyDigestService } from './services/weekly-digest.service';
import { WeeklyPerPersonService } from './services/weekly-per-person.service';
import { BlockerSynthesisCron } from './workers/blocker-synthesis.cron';
import { ChannelBindingCampaignCron } from './workers/channel-binding-campaign.cron';
import { CheckinGraphIngestListener } from './workers/checkin-graph-ingest.listener';
import { CheckinSentimentAnalyzerWorker } from './workers/checkin-sentiment-analyzer.worker';
import { CheckinSentimentBatchCron } from './workers/checkin-sentiment-batch.cron';
import { CustomerRiskRadarCron } from './workers/customer-risk-radar.cron';
import { DailyCheckInPromptCron } from './workers/daily-checkin-prompt.cron';
import { DayReportCollectorCron } from './workers/day-report-collector.cron';
import { DecisionImplementationCron } from './workers/decision-implementation.cron';
import { ExecMorningPushCron } from './workers/exec-morning-push.cron';
import { MeetingCheckinListener } from './workers/meeting-checkin.listener';
import { KnowledgeAtRiskCron } from './workers/knowledge-at-risk.cron';
import { OnboardingRampCron } from './workers/onboarding-ramp.cron';
import { OperationsDailyDigestCron } from './workers/operations-daily-digest.cron';
import { OperationsMonthlyDigestCron } from './workers/operations-monthly-digest.cron';
import { OperationsWeeklyDigestCron } from './workers/operations-weekly-digest.cron';
import { PersonalDailyBriefCron } from './workers/personal-daily-brief.cron';
import { CheckInConflictDetectorCron } from './workers/personal-relation-builder.worker';
import { PortfolioHealthSnapshotCron } from './workers/portfolio-health-snapshot.cron';
import { PromiseCascadeCron } from './workers/promise-cascade.cron';
import { ReflectionQualityScorerCron } from './workers/reflection-quality-scorer.cron';
import { TaskReconcileCron } from './workers/task-reconcile.cron';
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
    MonthlyDigestController,
  ],
  providers: [
    DailyCheckInService,
    DayReportCollectorService,
    DayReportCollectorCron,
    CheckinExpectationService,
    ClosureVerifierService,
    MeetingCheckinListener,
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
    MonthlyDigestService,
    OperationsMonthlyDigestCron,
    CheckinSentimentAnalyzerWorker,
    CheckinSentimentBatchCron,
    CommitmentsService,
    // TZ task-dedup (2026-06-16, Ф2) — петля «разговор → кандидат на закрытие
    // задачи». @OnEvent('task.completion_signalled'),
    // семантический матч открытой Issue + LLM-верификатор → обратимый
    // TaskClosureCandidate (авто-закрытие запрещено, R13).
    TaskCompletionHandler,
    // TZ task-dedup (2026-06-16, Ф3) — суточный reconcile петли закрытия:
    // протухание pending-кандидатов + пересчёт reopen-rate (метрика
    // task_closure_reopen_rate + WARN-алёрт) + подбор пропущенных событием
    // матчей (переэмит). Образец — DecisionImplementationCron (per-Org @Cron +
    // condition-UPDATE, БЕЗ LLM). Kill-switch taskReconcile.enabled (ON).
    TaskReconcileService,
    TaskReconcileCron,
    // SBA β-8.3 — ежедневный отчёт COO.
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
    MonthlyDigestService,
    CommitmentsService,
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
    DayReportCollectorService,
  ],
})
export class OperationsModule {}
