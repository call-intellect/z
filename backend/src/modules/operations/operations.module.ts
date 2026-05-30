import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ProbeModule } from '../probe/probe.module';
import { TrackerModule } from '../tracker/tracker.module';

import { DailyDigestController } from './controllers/daily-digest.controller';
import { MyCheckInsController } from './controllers/my-check-ins.controller';
import { MyPromisesController } from './controllers/my-promises.controller';
import { OperationsDashboardController } from './controllers/operations-dashboard.controller';
import { PersonalRelationsController } from './controllers/personal-relations.controller';
import { WeeklyDigestController } from './controllers/weekly-digest.controller';
import { CheckinParserService } from './services/checkin-parser.service';
import { CheckinResponseHandler } from './services/checkin-response.handler';
import { CommitmentResponseHandler } from './services/commitment-response.handler';
import { CommitmentsService } from './services/commitments.service';
import { DailyCheckInService } from './services/daily-checkin.service';
import { DailyDigestService } from './services/daily-digest.service';
import { GoalCascadeService } from './services/goal-cascade.service';
import { OperationsDashboardService } from './services/operations-dashboard.service';
import { PersonalRelationService } from './services/personal-relation.service';
import { Specialist39PromiseKeeperService } from './services/specialist-3-9-promise-keeper.service';
import { WeeklyDigestService } from './services/weekly-digest.service';
import { CheckinSentimentAnalyzerWorker } from './workers/checkin-sentiment-analyzer.worker';
import { CheckinSentimentBatchCron } from './workers/checkin-sentiment-batch.cron';
import { CommitmentFollowupCron } from './workers/commitment-followup.cron';
import { DailyCheckInPromptCron } from './workers/daily-checkin-prompt.cron';
import { OperationsDailyDigestCron } from './workers/operations-daily-digest.cron';
import { OperationsWeeklyDigestCron } from './workers/operations-weekly-digest.cron';
import { ReflectionQualityScorerCron } from './workers/reflection-quality-scorer.cron';

/**
 * SBA β-8 — OperationsModule.
 *
 * Содержит:
 *   - REST: `/api/v1/dashboard/operations/*`, `/api/v1/me/check-ins`,
 *     `/api/v1/personal-relations`.
 *   - DailyCheckInService — CRUD + upsert чек-инов.
 *   - OperationsDashboardService — агрегат пульса (с Redis-cache TTL 5 мин).
 *   - PersonalRelationService — read EntityLink между Person'ами.
 *   - GoalCascadeService — каскад статусов parent↔children Goals.
 *   - CheckinParserService — LLM-парсинг ответа на morning/evening probe.
 *   - CheckinResponseHandler — @OnEvent('notification.responded') для checkin.
 *   - DailyCheckInPromptCron — `@Cron('0 * * * *')` отправка morning/evening prompt.
 *
 * Зависимости:
 *   - PrismaModule (Global)
 *   - ConversationalModule (Global, не импортируется явно — берём из DI)
 *   - AiModule (LlmRouterService) — для CheckinParserService
 *   - MetricsModule — BusinessMetricsService
 *   - ScheduleModule.forRoot() — для @Cron (уже в AppModule)
 *   - RbacModule (Global) — RbacService для контроллеров
 *
 * PersonalRelationBuilderWorker зарегистрирован в WorkersModule (рядом с
 * другими Specialist3X-воркерами), чтобы он подхватился в worker-pipeline.
 *
 * Экспортируем GoalCascadeService — `GoalsService` (вне модуля) сможет дёрнуть
 * его при ручной смене статуса Goal.
 */
@Module({
  imports: [
    PrismaModule,
    // SBA β-8.2 — Хранитель обещаний использует ProbeService (followup +
    // escalation) и HolidayService (расчёт «следующего рабочего дня»).
    ProbeModule,
    TrackerModule,
  ],
  controllers: [
    OperationsDashboardController,
    MyCheckInsController,
    PersonalRelationsController,
    // SBA β-8.1 — новый endpoint недельного дайджеста.
    WeeklyDigestController,
    // SBA β-8.2 — `/me/promises`.
    MyPromisesController,
    // SBA β-8.3 — ежедневный отчёт COO.
    DailyDigestController,
  ],
  providers: [
    DailyCheckInService,
    OperationsDashboardService,
    PersonalRelationService,
    GoalCascadeService,
    CheckinParserService,
    CheckinResponseHandler,
    DailyCheckInPromptCron,
    // SBA β-8.1 — voiceless над основными сервисами β-8.
    WeeklyDigestService,
    OperationsWeeklyDigestCron,
    CheckinSentimentAnalyzerWorker,
    // ТЗ 2026-05-25 LLM-architecture §6 — batch-cron (основной механизм
    // sentiment-классификации, в 2× дешевле и точнее single через event).
    CheckinSentimentBatchCron,
    // SBA β-8.2 — Хранитель обещаний.
    CommitmentsService,
    Specialist39PromiseKeeperService,
    CommitmentFollowupCron,
    CommitmentResponseHandler,
    // SBA β-8.3 — ежедневный отчёт COO.
    DailyDigestService,
    OperationsDailyDigestCron,
    // Pulse Wave 3 §3.5 — hourly LLM-оценка качества рефлексии чек-инов.
    ReflectionQualityScorerCron,
  ],
  exports: [
    GoalCascadeService,
    DailyCheckInService,
    OperationsDashboardService,
    PersonalRelationService,
    CheckinParserService,
    WeeklyDigestService,
    // SBA β-8.2 — экспортируем для тестов / повторного использования.
    CommitmentsService,
    Specialist39PromiseKeeperService,
    // SBA β-8.3 — экспортируем для тестов / повторного использования.
    DailyDigestService,
  ],
})
export class OperationsModule {}
