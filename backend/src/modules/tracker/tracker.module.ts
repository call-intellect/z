import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { ActivityDigestController } from './controllers/activity-digest.controller';
import { AttachmentsController } from './controllers/attachments.controller';
import { BoardsController } from './controllers/boards.controller';
import { ChecklistsController } from './controllers/checklists.controller';
import { CommentsController } from './controllers/comments.controller';
import { ProgressUpdatesController } from './controllers/progress-updates.controller';
import { CyclesController } from './controllers/cycles.controller';
import { DocumentUploadsController } from './controllers/document-uploads.controller';
import { HolidaysController } from './controllers/holidays.controller';
import { ImportsController } from './controllers/imports.controller';
import { IntakeController } from './controllers/intake.controller';
import { IssuesController } from './controllers/issues.controller';
import { LabelsController } from './controllers/labels.controller';
import { MeInboxController } from './controllers/me-inbox.controller';
import { MeTasksController } from './controllers/me-tasks.controller';
import { MyMentionsController } from './controllers/my-mentions.controller';
import { OrgIssuesController } from './controllers/org-issues.controller';
import { OverviewController } from './controllers/overview.controller';
import { ProjectDocumentsController } from './controllers/project-documents.controller';
import { ProjectsController } from './controllers/projects.controller';
import { RelationsController } from './controllers/relations.controller';
import { SprintHintsController } from './controllers/sprint-hints.controller';
import { SprintsController } from './controllers/sprints.controller';
import { StatesController } from './controllers/states.controller';
import { TeamTemplatesController } from './controllers/team-templates.controller';
import { TrackerWebhooksController } from './controllers/webhooks.controller';
import { TrackerGateway } from './gateways/tracker.gateway';
import { ActivityRecorderService } from './services/activity-recorder.service';
import { AssigneeResolverService } from './services/assignee-resolver.service';
import { AttachmentsService } from './services/attachments.service';
import { BoardsService } from './services/boards.service';
import { ChecklistsService } from './services/checklists.service';
import { CommentsService } from './services/comments.service';
import { ProgressUpdatesService } from './services/progress-updates.service';
import { CycleMeetingsService } from './services/cycle-meetings.service';
import { CyclesService } from './services/cycles.service';
import { HolidayService } from './services/holiday.service';
import { ImportService } from './services/import.service';
import { IntakeAutoTriageQueueService } from './services/intake-auto-triage-queue.service';
import { IntakeService } from './services/intake.service';
import { IntegrationsStatusService } from './services/integrations-status.service';
import { IssueActivityDigestService } from './services/issue-activity-digest.service';
import { IssueGoalSuggestService } from './services/issue-goal-suggest.service';
import { IssueInferFieldsService } from './services/issue-infer-fields.service';
import { IssueMeetingsService } from './services/issue-meetings.service';
import { IssuesService } from './services/issues.service';
import { LabelsService } from './services/labels.service';
import { MeTasksService } from './services/me-tasks.service';
import { MeetingExtractActionsService } from './services/meeting-extract-actions.service';
import { MyMentionsService } from './services/my-mentions.service';
import { OverviewService } from './services/overview.service';
import { ProjectDocumentsService } from './services/project-documents.service';
import { ProjectsFromTemplateService } from './services/projects-from-template.service';
import { ProjectsService } from './services/projects.service';
import { RelationsService } from './services/relations.service';
import { SimilarIssuesService } from './services/similar-issues.service';
import { SprintAnalystService } from './services/sprint-analyst.service';
import { SprintArchiveService } from './services/sprint-archive.service';
import { SprintHintsService } from './services/sprint-hints.service';
import { SprintsService } from './services/sprints.service';
import { StatesService } from './services/states.service';
import { TaskDedupService } from './services/task-dedup.service';
import { TrackerEmitterService } from './services/tracker-emitter.service';
import { TrackerEventsService } from './services/tracker-events.service';
import { WebhookDispatcher } from './services/webhook-dispatcher.service';
import { WebhookSigner } from './services/webhook-signer.service';
import { WebhooksService } from './services/webhooks.service';
import { WorkloadService } from './services/workload.service';
import { Bitrix24ImportStrategy } from './strategies/bitrix24-import.strategy';
import { TrelloImportStrategy } from './strategies/trello-import.strategy';
import { YandexTrackerImportStrategy } from './strategies/yandex-tracker-import.strategy';
import { GoalAlignmentLowCron } from './workers/goal-alignment-low.cron';
import { ImportTrackerWorker } from './workers/import-tracker.worker';
import { IntakeAutoTriageWorker } from './workers/intake-auto-triage.worker';
import { IssueOverdueDetectorCron } from './workers/issue-overdue-detector.cron';
import { IssueStateGaugeCron } from './workers/issue-state-gauge.cron';
import { ProgressAutoDraftCron } from './workers/progress-auto-draft.cron';
import { WebhookDeliveryWorker } from './workers/webhook-delivery.worker';

@Module({
  imports: [PrismaModule],
  controllers: [
    ProjectsController,
    BoardsController,
    IssuesController,
    CyclesController,
    IntakeController,
    CommentsController,
    ProgressUpdatesController,
    ActivityDigestController,
    LabelsController,
    TrackerWebhooksController,
    TeamTemplatesController,
    RelationsController,
    AttachmentsController,
    HolidaysController,
    ImportsController,
    MeInboxController,
    // tasks-unified-workspace Ф1 (2026-06-18): GET /api/v1/issues — сквозной
    // список задач всей организации (рабочий стол «Задачи») с видимостью
    // по роли/visibilityMode.
    OrgIssuesController,
    MeTasksController,
    MyMentionsController,
    StatesController,
    ChecklistsController,
    ProjectDocumentsController,
    DocumentUploadsController,
    OverviewController,
    SprintHintsController,
    SprintsController,
  ],
  providers: [
    ActivityRecorderService,
    IssueActivityDigestService,
    AssigneeResolverService,
    ProjectsService,
    ProjectsFromTemplateService,
    HolidayService,
    BoardsService,
    IssuesService,
    MeTasksService,
    SimilarIssuesService,
    // TZ task-dedup (2026-06-16, Ф1) — единый дедуп-гейт перед записью задачи
    // (intake + прямой create). Зависит от @Global Ai/Embeddings/AdminSettings/
    // KnowledgeCore (Llm/Embedding/Calibration). Только suggest, авто-merge нет.
    TaskDedupService,
    CyclesService,
    IntakeService,
    CommentsService,
    ProgressUpdatesService,
    LabelsService,
    WebhooksService,
    RelationsService,
    AttachmentsService,
    IssueMeetingsService,
    ChecklistsService,
    ProjectDocumentsService,
    StatesService,
    MyMentionsService,
    TrackerGateway,
    TrackerEventsService,
    WebhookSigner,
    WebhookDispatcher,
    WebhookDeliveryWorker,
    TrackerEmitterService,
    IssueOverdueDetectorCron,
    IssueStateGaugeCron,
    GoalAlignmentLowCron,
    ProgressAutoDraftCron,
    IssueInferFieldsService,
    IssueGoalSuggestService,
    MeetingExtractActionsService,
    IntakeAutoTriageQueueService,
    IntakeAutoTriageWorker,
    ImportService,
    ImportTrackerWorker,
    TrelloImportStrategy,
    Bitrix24ImportStrategy,
    YandexTrackerImportStrategy,
    OverviewService,
    WorkloadService,
    IntegrationsStatusService,
    SprintAnalystService,
    SprintHintsService,
    CycleMeetingsService,
    SprintsService,
    SprintArchiveService,
  ],
  exports: [
    IssuesService,
    ActivityRecorderService,
    TrackerEventsService,
    TrackerEmitterService,
    MeetingExtractActionsService,
    IntakeService,
    CommentsService,
    ProgressUpdatesService,
    IntakeAutoTriageQueueService,
    HolidayService,
    SprintAnalystService,
    // TZ task-dedup (2026-06-16, Ф2) — TaskCompletionHandler (operations)
    // переиспользует findSimilarByVector для семантического матча
    // сигнал-блок «сделал X» → открытая Issue (кандидат на закрытие).
    SimilarIssuesService,
  ],
})
export class TrackerModule {}
