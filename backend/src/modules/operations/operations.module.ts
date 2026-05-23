import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { MyCheckInsController } from './controllers/my-check-ins.controller';
import { OperationsDashboardController } from './controllers/operations-dashboard.controller';
import { PersonalRelationsController } from './controllers/personal-relations.controller';
import { CheckinParserService } from './services/checkin-parser.service';
import { CheckinResponseHandler } from './services/checkin-response.handler';
import { DailyCheckInService } from './services/daily-checkin.service';
import { GoalCascadeService } from './services/goal-cascade.service';
import { OperationsDashboardService } from './services/operations-dashboard.service';
import { PersonalRelationService } from './services/personal-relation.service';
import { DailyCheckInPromptCron } from './workers/daily-checkin-prompt.cron';

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
  imports: [PrismaModule],
  controllers: [
    OperationsDashboardController,
    MyCheckInsController,
    PersonalRelationsController,
  ],
  providers: [
    DailyCheckInService,
    OperationsDashboardService,
    PersonalRelationService,
    GoalCascadeService,
    CheckinParserService,
    CheckinResponseHandler,
    DailyCheckInPromptCron,
  ],
  exports: [
    GoalCascadeService,
    DailyCheckInService,
    OperationsDashboardService,
    PersonalRelationService,
    CheckinParserService,
  ],
})
export class OperationsModule {}
