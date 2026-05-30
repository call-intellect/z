import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { OperationsModule } from '../operations/operations.module';

import { BurnoutRiskDetectorCron } from './agents/burnout-risk-detector.cron';
import { EngagementScorerCron } from './agents/engagement-scorer.cron';
import { HrRecommenderCron } from './agents/hr-recommender.cron';
import { TeamHealthAnalyzerCron } from './agents/team-health-analyzer.cron';
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
