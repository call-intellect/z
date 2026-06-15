import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';
// Action Center B2 — блок «Требует вашего подтверждения» на дашборде директора.
// Экспортирует PendingActionsService.
import { PendingActionsModule } from '../pending-actions/pending-actions.module';

import { BurnoutRiskDetectorCron } from './agents/burnout-risk-detector.cron';
import { BusFactorAnalyzerCron } from './agents/bus-factor-analyzer.cron';
// Pulse Wave 6 §6.8 — Decision-Hygiene-Scorer (event-driven worker).
import { DecisionHygieneScorerWorker } from './agents/decision-hygiene-scorer.worker';
import { EngagementScorerCron } from './agents/engagement-scorer.cron';
import { ForecasterCron } from './agents/forecaster.cron';
import { GoalVectorTrackerCron } from './agents/goal-vector-tracker.cron';
import { HrRecommenderCron } from './agents/hr-recommender.cron';
import { KnowledgeVelocityTrackerCron } from './agents/knowledge-velocity-tracker.cron';
// Pulse Wave 6 §6.3 — Meeting-ROI-Scorer (event-driven worker).
import { MeetingRoiScorerWorker } from './agents/meeting-roi-scorer.worker';
import { PromiseNetworkAnalyzerCron } from './agents/promise-network-analyzer.cron';
import { TeamHealthAnalyzerCron } from './agents/team-health-analyzer.cron';
import { ThemeSilenceDetectorCron } from './agents/theme-silence-detector.cron';
import { TopicRecurrenceDetectorCron } from './agents/topic-recurrence-detector.cron';
import { DirectorDashboardController } from './director-dashboard.controller';
import { CommitmentReliabilityService } from './services/commitment-reliability.service';
// Pulse Wave 6 §6.3/§6.8 — producer для воркеров ROI и Decision-Hygiene.
// Экспортируется наружу, чтобы AnalyzeWorker / Specialist33DecisionsWorker
// могли его @Optional() инжектить из WorkersModule.
import { DashboardQueueService } from './services/dashboard-queue.service';
import { DirectorDashboardService } from './services/director-dashboard.service';
import { HangingDecisionsService } from './services/hanging-decisions.service';
import { NarrativeCitationsParserService } from './services/narrative-citations-parser.service';
// ТЗ-G Фаза 1 — серверное ранжирование «Сотрудники под риском»
// (`GET /api/v1/dashboard/people-at-risk`). Использует CommitmentReliabilityService.
import { PeopleAtRiskService } from './services/people-at-risk.service';
// Pulse Wave 6 — единый агрегатор паттернов для главной директора
// (`GET /api/v1/dashboard/pulse-patterns`).
import { PulsePatternsService } from './services/pulse-patterns.service';
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
  imports: [PrismaModule, OperationsModule, PendingActionsModule],
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
    // Pulse Wave 6 — единый агрегатор 7 паттернов для главной директора.
    PulsePatternsService,
    // ТЗ-G Фаза 1 — «Сотрудники под риском» (топ-N по pulseScore).
    PeopleAtRiskService,
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
    // Редизайн кабинета Ф8.2 🔴 — Theme-Silence-Detector (daily 04:00 UTC,
    // NO LLM): активные каноничные темы с lastSignalAt старше N недель →
    // Insight kind='risk' «Тема молчит N недель» (идемпотентно по
    // causeCategory='ts:<themeId>'). Kill-switch dashboard.theme_silence.enabled.
    ThemeSilenceDetectorCron,
    PromiseNetworkAnalyzerCron,
    GoalVectorTrackerCron,
    KnowledgeVelocityTrackerCron,
    // Pulse Wave 6 §6.3 / §6.8 — event-driven воркеры (BullMQ) и producer.
    // - DashboardQueueService — producer (enqueueMeetingRoi / enqueueDecisionHygiene).
    // - MeetingRoiScorerWorker — consumer dashboard.meeting-roi (NO LLM, формула).
    // - DecisionHygieneScorerWorker — consumer dashboard.decision-hygiene
    //   (LLM taskType='decision-hygiene', Bezos type-1/type-2).
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
    // Pulse Wave 6 — публичный API сервиса (вдруг понадобится для интеграции
    // в др. модули; контроллер ходит напрямую).
    PulsePatternsService,
    // Pulse Wave 6 §6.3/§6.8 — producer для cross-module enqueue из
    // AnalyzeWorker / Specialist33DecisionsWorker.
    DashboardQueueService,
    // парсер не экспортируем — внутренний для dashboard
  ],
})
export class DashboardModule {}
