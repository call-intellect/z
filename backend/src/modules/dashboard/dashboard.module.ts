import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';

import { BurnoutRiskDetectorCron } from './agents/burnout-risk-detector.cron';
import { BusFactorAnalyzerCron } from './agents/bus-factor-analyzer.cron';
import { EngagementScorerCron } from './agents/engagement-scorer.cron';
import { ForecasterCron } from './agents/forecaster.cron';
import { GoalVectorTrackerCron } from './agents/goal-vector-tracker.cron';
import { HrRecommenderCron } from './agents/hr-recommender.cron';
import { KnowledgeVelocityTrackerCron } from './agents/knowledge-velocity-tracker.cron';
import { PromiseNetworkAnalyzerCron } from './agents/promise-network-analyzer.cron';
import { TeamHealthAnalyzerCron } from './agents/team-health-analyzer.cron';
import { TopicRecurrenceDetectorCron } from './agents/topic-recurrence-detector.cron';
import { DirectorDashboardController } from './director-dashboard.controller';
import { CommitmentReliabilityService } from './services/commitment-reliability.service';
import { DirectorDashboardService } from './services/director-dashboard.service';
import { HangingDecisionsService } from './services/hanging-decisions.service';
import { NarrativeCitationsParserService } from './services/narrative-citations-parser.service';
import { SentimentIndexService } from './services/sentiment-index.service';
import { TeamDetailService } from './services/team-detail.service';
import { TeamHealthService } from './services/team-health.service';

/**
 * DashboardModule (Фаза 8 knowledge-core).
 *
 * Содержит директорский дашборд (`GET /api/v1/dashboard/director`).
 * Менеджерский дашборд (фронт `/dashboard` для `manager`-ролей) использует
 * существующие endpoint'ы Meetings/Tasks — отдельной backend-логики не требует.
 *
 * Зависимости:
 *   - PrismaModule (Global) — БД-запросы.
 *   - OperationsModule — `OperationsDashboardService.getTeamTemperature`
 *     переиспользуется в `SentimentIndexService` (Pulse Wave 1 §1.3).
 *   - AdminModule (Global, экспортирует AdminCacheService) — кэш TTL 60s.
 *   - RbacModule (Global) — `RbacService.canViewDirectorDashboard`.
 *   - AiModule (Global) — `LlmRouterService` для `narrativeSummary` (шаг 2 ТЗ).
 *
 * Глобальные зависимости — `@Global()`, явный `imports` нужен только для
 * PrismaModule и OperationsModule. AdminModule / RbacModule / AiModule подняты
 * в AppModule.
 */
@Module({
  imports: [PrismaModule, OperationsModule],
  controllers: [DirectorDashboardController],
  providers: [
    DirectorDashboardService,
    CommitmentReliabilityService,
    HangingDecisionsService,
    SentimentIndexService,
    NarrativeCitationsParserService,
    // Pulse Wave 1 §1.6 — Team Health Grid (per-dept агрегаты).
    TeamHealthService,
    // Pulse Wave 2 §2.5 — детальная страница /teams/[id].
    TeamDetailService,
    // Pulse Wave 3 §3.1 / §3.3 / §3.7 — 3 cron-агента дашборда.
    // - TeamHealthAnalyzerCron: ежедневный LLM-анализ 5-факторов отдела.
    // - EngagementScorerCron: ежедневный сводный engagement-score per person.
    // - HrRecommenderCron: weekly HR-рекомендации руководителю.
    TeamHealthAnalyzerCron,
    EngagementScorerCron,
    HrRecommenderCron,
    // Pulse Wave 4 §4.5 — Burnout-Risk-Detector (daily, NO LLM).
    // Только employee с analyticsOptIn=true; вычисляет активные risk-flag'и
    // (sentiment_dip / missed_checkins / broken_promises / conflict_mentions)
    // относительно личного 90-day baseline. Пишет в Person.riskFlagsJson.
    BurnoutRiskDetectorCron,
    // Pulse Wave 4 §4.6 — Forecaster (weekly, LLM).
    // Mon 04:00 UTC: считает 4-недельные тренды 4 метрик, вызывает
    // `forecast-weekly` LLM-агента и сохраняет ForecastSnapshot
    // (scope='company'). Используется в Weekly digest вместо placeholder'а §2.2.
    ForecasterCron,
    // Pulse Wave 6 — 5 weekly cron-агентов (Mon 05:00 UTC, после Forecaster).
    // §6.1 BusFactorAnalyzerCron       — bus factor per knowledge category (NO LLM).
    // §6.2 TopicRecurrenceDetectorCron — Theme'ы обсуждаемые без Decision (NO LLM).
    // §6.5 PromiseNetworkAnalyzerCron  — граф обещаний accumulator/donor (NO LLM).
    // §6.6 GoalVectorTrackerCron       — LLM-агент pro/contra per (person, goal).
    // §6.7 KnowledgeVelocityTrackerCron — median time gap → answer (NO LLM).
    BusFactorAnalyzerCron,
    TopicRecurrenceDetectorCron,
    PromiseNetworkAnalyzerCron,
    GoalVectorTrackerCron,
    KnowledgeVelocityTrackerCron,
  ],
  exports: [
    CommitmentReliabilityService,
    HangingDecisionsService,
    SentimentIndexService,
    TeamHealthService,
    TeamDetailService,
    // парсер не экспортируем — внутренний для dashboard
  ],
})
export class DashboardModule {}
