import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AttachmentsController } from './controllers/attachments.controller';
import { CommentsController } from './controllers/comments.controller';
import { CyclesController } from './controllers/cycles.controller';
import { HolidaysController } from './controllers/holidays.controller';
import { ImportsController } from './controllers/imports.controller';
import { IntakeController } from './controllers/intake.controller';
import { IssuesController } from './controllers/issues.controller';
import { LabelsController } from './controllers/labels.controller';
import { MeInboxController } from './controllers/me-inbox.controller';
import { ProjectsController } from './controllers/projects.controller';
import { RelationsController } from './controllers/relations.controller';
import { StatesController } from './controllers/states.controller';
import { TeamTemplatesController } from './controllers/team-templates.controller';
import { TrackerWebhooksController } from './controllers/webhooks.controller';
import { TrackerGateway } from './gateways/tracker.gateway';
import { ActivityRecorderService } from './services/activity-recorder.service';
import { AttachmentsService } from './services/attachments.service';
import { CommentsService } from './services/comments.service';
import { CyclesService } from './services/cycles.service';
import { HolidayService } from './services/holiday.service';
import { ImportService } from './services/import.service';
import { IntakeAutoTriageQueueService } from './services/intake-auto-triage-queue.service';
import { IntakeService } from './services/intake.service';
import { IssueGoalSuggestService } from './services/issue-goal-suggest.service';
import { IssueInferFieldsService } from './services/issue-infer-fields.service';
import { IssueMeetingsService } from './services/issue-meetings.service';
import { IssuesService } from './services/issues.service';
import { LabelsService } from './services/labels.service';
import { MeetingExtractActionsService } from './services/meeting-extract-actions.service';
import { ProjectsFromTemplateService } from './services/projects-from-template.service';
import { ProjectsService } from './services/projects.service';
import { RelationsService } from './services/relations.service';
import { StatesService } from './services/states.service';
import { TrackerEmitterService } from './services/tracker-emitter.service';
import { TrackerEventsService } from './services/tracker-events.service';
import { WebhookDispatcher } from './services/webhook-dispatcher.service';
import { WebhookSigner } from './services/webhook-signer.service';
import { WebhooksService } from './services/webhooks.service';
import { Bitrix24ImportStrategy } from './strategies/bitrix24-import.strategy';
import { TrelloImportStrategy } from './strategies/trello-import.strategy';
import { YandexTrackerImportStrategy } from './strategies/yandex-tracker-import.strategy';
import { ImportTrackerWorker } from './workers/import-tracker.worker';
import { IntakeAutoTriageWorker } from './workers/intake-auto-triage.worker';
import { IssueOverdueDetectorCron } from './workers/issue-overdue-detector.cron';
import { IssueStateGaugeCron } from './workers/issue-state-gauge.cron';
import { WebhookDeliveryWorker } from './workers/webhook-delivery.worker';

/**
 * TrackerModule.
 *
 * Sprint 1 (B1-1.3 / B1-1.4): модели + REST + IssueActivity recorder + RBAC.
 * Sprint 2 (B1-2.2): + TrackerGateway (WebSocket events) +
 *                    + WebhookDeliveryWorker (BullMQ delivery с HMAC + retry).
 *
 * Зависимости (через @Global модули):
 *   - PrismaModule (явно ниже для ясности).
 *   - RbacModule (@Global) — RbacService + TenantGuard.
 *   - AuthModule (@Global) — CookieAuthGuard + JwtService для WS handshake.
 *   - RedisModule (@Global) — для BullMQ Queue/Worker.
 *   - MetricsModule (@Global) — BusinessMetricsService для webhook метрик.
 *
 * Эндпоинты — под глобальным префиксом `/api/v1` (см. main.ts).
 * WebSocket — namespace `/ws/tracker` (без префикса `/api/v1`).
 *
 * Документация: plans/tz/2026-05-23-tracker-phase-1-models-api.md
 * Sprint Plan: plans/sprints/2026-05-24-sprint-plan-wave-1.md
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    ProjectsController,
    IssuesController,
    CyclesController,
    IntakeController,
    CommentsController,
    LabelsController,
    TrackerWebhooksController,
    TeamTemplatesController,
    RelationsController,
    AttachmentsController,
    // Tracker Phase 4 part 2 (Sprint 9, 2026-05-24) — производственный календарь
    // (read + per-tenant override).
    HolidaysController,
    // Tracker Phase 5 part 1 (2026-05-24) — миграционный wizard
    // `/api/v1/tracker/imports/{trello,bitrix24,yandex-tracker}` + list/get/cancel.
    ImportsController,
    // Sprint 3 Frontend Wave 2 prerequisite:
    // /api/v1/me/inbox — мои задачи (assignee=me) во всех проектах.
    // /api/v1/states — справочник IssueState для board + фильтров.
    MeInboxController,
    StatesController,
  ],
  providers: [
    ActivityRecorderService,
    ProjectsService,
    // Tracker Phase 4 part 2 (Sprint 9, 2026-05-24) — POST /projects/from-template.
    // Загружает TeamTemplate (per-tenant → system fallback), создаёт Project,
    // IssueState, ProjectMember admin, Regulation-заглушки, опц. примеры задач.
    ProjectsFromTemplateService,
    // Tracker Phase 4 part 2 — проверка попадания dueDate на праздник + сдвиг.
    // Используется HolidaysController (read); интеграция с IssuesService —
    // см. отчёт оркестратора (Sprint 10).
    HolidayService,
    IssuesService,
    CyclesService,
    IntakeService,
    CommentsService,
    LabelsService,
    WebhooksService,
    RelationsService,
    AttachmentsService,
    IssueMeetingsService,
    // Sprint 3 Frontend Wave 2: read-only справочник статусов.
    StatesService,
    // Sprint 2: WebSocket + Webhooks delivery.
    TrackerGateway,
    TrackerEventsService,
    WebhookSigner,
    WebhookDispatcher,
    WebhookDeliveryWorker,
    // Sprint 3 B1-3.1: TrackerEmitterService — публикация `tracker.event_occurred`
    // в шину @nestjs/event-emitter; TrackerAdapter (IngestModule) ловит и
    // создаёт RawEvent. Принцип «трекер = источник для второго мозга».
    TrackerEmitterService,
    IssueOverdueDetectorCron,
    IssueStateGaugeCron,
    // Tracker Phase 3 part C (2026-05-24) — AI-suggest при создании задачи.
    // Зависят от LlmRouterService (@Global AiModule). Inject в IssuesService.create()
    // через @Optional() — фронт получает aiSuggestions только при inferSuggestions=true.
    IssueInferFieldsService,
    IssueGoalSuggestService,
    // Tracker Phase 3 part B (2026-05-24) — автозадачи из встреч + auto-triage Intake.
    // - MeetingExtractActionsService — вызывается из analyze.worker после ai_ready;
    //   создаёт IntakeIssue с suggested* полями.
    // - IntakeAutoTriageQueueService — продьюсер очереди `core.intake-auto-triage`.
    // - IntakeAutoTriageWorker — consumer той же очереди: LLM-suggest +
    //   auto-create Issue при confidence ≥ 0.92 + source='meeting' + assignee.
    MeetingExtractActionsService,
    IntakeAutoTriageQueueService,
    IntakeAutoTriageWorker,
    // Tracker Phase 5 part 1 (2026-05-24) — миграционный wizard.
    //  - ImportService — продьюсер очереди `core.imports` + CRUD ImportLog.
    //  - ImportTrackerWorker — consumer: загружает ImportLog, делегирует в
    //    стратегию по source. Concurrency=2.
    //  - TrelloImportStrategy — полная реализация JSON-export импорта.
    //  - Bitrix24/YandexTracker — заглушки (NotImplemented; реализация в part 2).
    ImportService,
    ImportTrackerWorker,
    TrelloImportStrategy,
    Bitrix24ImportStrategy,
    YandexTrackerImportStrategy,
  ],
  exports: [
    // Экспортируется только то, что нужно другим модулям. Все services не
    // экспортируем — снаружи модуль доступен через REST API. Исключения:
    //   - IssuesService — будет нужен `Specialist3X/intake-adapter` (Sprint 2-3).
    //   - ActivityRecorderService — может пригодиться AI-агентам в Sprint 3
    //     (запись активности от ai_agent при автоматических действиях).
    //   - TrackerEventsService — другие модули могут публиковать live-события.
    //   - TrackerEmitterService — экспортируем, чтобы другие модули могли
    //     эмитить от имени трекера (опционально, MVP не использует).
    IssuesService,
    ActivityRecorderService,
    TrackerEventsService,
    TrackerEmitterService,
    // Wave 3 / Tracker Phase 3 part B — AnalyzeWorker (модуль AI/Workers)
    // инжектит MeetingExtractActionsService через @Optional() для best-effort
    // вызова после ai_ready. Экспортируем здесь, чтобы DI-граф работал.
    MeetingExtractActionsService,
    // Wave 3 / Tracker Phase 4 РФ (2026-05-24) — TelegramBotMessageHandler
    // (ConversationalModule импортирует TrackerModule) инжектит эти сервисы
    // через @Optional() для полноценной работы 4 сценариев бота:
    //   - IntakeService — для idempotent intakeIssue.find/upsert (parser).
    //   - CommentsService — IssueComment create при reply на task-уведомление.
    //   - IntakeAutoTriageQueueService — enqueue auto-triage на confidence ≥ 0.85.
    //   - IssuesService уже выше — для transitionState по status-command reply.
    IntakeService,
    CommentsService,
    IntakeAutoTriageQueueService,
  ],
})
export class TrackerModule {}
