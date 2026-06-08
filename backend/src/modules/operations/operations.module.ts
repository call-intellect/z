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
import { Specialist39PromiseKeeperService } from './services/specialist-3-9-promise-keeper.service';
import { ValueRecapService } from './services/value-recap.service';
import { WeeklyDigestService } from './services/weekly-digest.service';
import { WeeklyPerPersonService } from './services/weekly-per-person.service';
import { BlockerSynthesisCron } from './workers/blocker-synthesis.cron';
import { ChannelBindingCampaignCron } from './workers/channel-binding-campaign.cron';
import { CheckinSentimentAnalyzerWorker } from './workers/checkin-sentiment-analyzer.worker';
import { CustomerRiskRadarCron } from './workers/customer-risk-radar.cron';
import { DecisionImplementationCron } from './workers/decision-implementation.cron';
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
import { ReflectionQualityScorerCron } from './workers/reflection-quality-scorer.cron';
import { ValueRecapCron } from './workers/value-recap.cron';

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
    // Action Center B3 — DailyDigestService использует PendingActionsService
    // для блока «Ждёт подтверждения» в ежедневном отчёте.
    PendingActionsModule,
    // TZ-1 Фаза 5 (daily-value-engine) — ValueRecapService переиспользует
    // ChatV2FeedbackService.getChatUsageStats (метрика чата в месячной витрине).
    // ChatV2Module НЕ импортирует OperationsModule → циклической зависимости нет.
    ChatV2Module,
    // ТЗ-2 Ф5 (daily-value-dashboards) — MyDailyValueController переиспользует
    // IdeasService.listMine (судьба моих идей). IdeasModule экспортирует
    // IdeasService; Ideas НЕ импортирует OperationsModule → цикла нет.
    IdeasModule,
  ],
  controllers: [
    OperationsDashboardController,
    MyCheckInsController,
    PersonalRelationsController,
    // SBA β-8.1 — новый endpoint недельного дайджеста.
    WeeklyDigestController,
    // ТЗ-D Фаза 4 — недельный план-факт по людям.
    WeeklyPerPersonController,
    // SBA β-8.2 — `/me/promises`.
    MyPromisesController,
    // SBA β-8.3 — ежедневный отчёт COO.
    DailyDigestController,
    // TZ-1 Фаза 1 (daily-value-engine) — мои клиенты под риском (self-scope).
    MyCustomerRiskController,
    // TZ-1 Фаза 2 (daily-value-engine) — движок рядового: «Твой день» + «кто
    // знает X» (self-scope `/me/daily-brief`, `/me/knows-who`).
    MyDailyBriefController,
    // ТЗ-2 Ф4 (daily-value-dashboards) — self-view недельного план-факта
    // (`/me/weekly-per-person`): моя строка + среднее команды, без RBAC.
    MyWeeklyPerPersonController,
    // ТЗ-2 Ф5 (daily-value-dashboards) — виджеты ежедневной ценности в /me:
    // судьба моих идей (`/me/ideas`) + полученные признания (`/me/recognitions`),
    // оба self-scope, гейт `me.daily_value_widgets.enabled`.
    MyDailyValueController,
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
    // ТЗ-D Фаза 4 — недельный план-факт по людям.
    WeeklyPerPersonService,
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
    // Pulse Wave 4 §3.2 — расширение Conflict-Detector: daily-скан чек-инов
    // на парные конфликт-маркеры → EntityLink('conflicted_with').
    // Не путать с воркером PersonalRelationBuilderWorker, который слушает
    // BullMQ-очередь и обрабатывает IdeaBlock'и; этот cron — отдельный agent
    // в том же файле, daily в 04:00 UTC.
    CheckInConflictDetectorCron,
    // TZ-1 Фаза 0 (daily-value-engine) — кампания привязки Telegram-канала
    // (приглашение + напоминание), @Cron('0 9 * * *'). Использует
    // ConversationalService (@Global).
    ChannelBindingCampaignCron,
    // TZ-1 Фаза 1 (daily-value-engine) — радар клиентов под риском:
    // сервис (computeForTenant + чтение для эндпоинтов) + cron @Cron('0 21 * * *').
    CustomerRiskRadarService,
    CustomerRiskRadarCron,
    // TZ-1 Фаза 2 (daily-value-engine) — движок рядового: бриф «Твой день»
    // (buildFor + чтение/upsert) + помощник «кто знает X» (semantic) + cron
    // @Cron('0 * * * *') (утреннее окно по Person.timezone). KnowsWhoService
    // инжектит KnowledgeEmbeddingService из @Global KnowledgeCoreModule.
    PersonalDailyBriefService,
    KnowsWhoService,
    PersonalDailyBriefCron,
    // TZ-1 Фаза 3.A (daily-value-engine) — накопительный синтез блокеров:
    // сервис (computeForTenant + чтение для эндпоинта) + cron @Cron('0 22 * * *').
    // BlockerSynthesisService инжектит Specialist35Service из @Global
    // KnowledgeCoreModule (мост хроники в Insight).
    BlockerSynthesisService,
    BlockerSynthesisCron,
    // TZ-1 Фаза 3.B (daily-value-engine) — контролёр внедрения решений:
    // сервис (computeForTenant + getDecisionThroughput + listStalled) +
    // cron @Cron('0 6 * * *').
    DecisionImplementationService,
    DecisionImplementationCron,
    // TZ-1 Фаза 3.C (daily-value-engine) — каскад обещаний: сервис
    // (findCascadesForTenant) + cron @Cron('0 8 * * *').
    PromiseCascadeService,
    PromiseCascadeCron,
    // TZ-1 Фаза 4.C (daily-value-engine) — знание-под-риском × уход человека:
    // сервис (computeForTenant + listForTenant) + weekly cron @Cron('0 5 * * 1').
    // Push только руководителю (носителю — ничего, этика).
    KnowledgeAtRiskService,
    KnowledgeAtRiskCron,
    // TZ-1 Фаза 4.D (daily-value-engine) — capacity-агрегат по командам:
    // сервис aggregate (group by department, classifyCapacity). Endpoint
    // /dashboard/operations/team-capacity. Без cron (читается on-demand + COO).
    TeamCapacityService,
    // TZ-1 Фаза 4.E (daily-value-engine) — онбординг-рамп новичка: сервис
    // listForTenant (isOnboardingStalled) + daily cron @Cron('0 7 * * *').
    OnboardingRampService,
    OnboardingRampCron,
    // TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap: сервис
    // (build + read/opened/export, reuse getDecisionThroughput + getChatUsageStats)
    // + cron @Cron('0 7 1 * *') (1-е число месяца, push-first владельцу/COO).
    ValueRecapService,
    ValueRecapCron,
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
    // TZ-1 Фаза 1 (daily-value-engine) — экспортируем для тестов / reuse.
    CustomerRiskRadarService,
    // TZ-1 Фаза 2 (daily-value-engine) — экспортируем для тестов / reuse.
    PersonalDailyBriefService,
    KnowsWhoService,
    // TZ-1 Фаза 3.A/B/C (daily-value-engine) — экспортируем для тестов / reuse.
    BlockerSynthesisService,
    DecisionImplementationService,
    PromiseCascadeService,
    // TZ-1 Фаза 4 (daily-value-engine) — экспортируем для тестов / reuse.
    KnowledgeAtRiskService,
    TeamCapacityService,
    OnboardingRampService,
    // TZ-1 Фаза 5 (daily-value-engine) — экспортируем для тестов / reuse.
    ValueRecapService,
  ],
})
export class OperationsModule {}
