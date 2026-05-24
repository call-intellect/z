import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AttachmentsController } from './controllers/attachments.controller';
import { CommentsController } from './controllers/comments.controller';
import { CyclesController } from './controllers/cycles.controller';
import { IntakeController } from './controllers/intake.controller';
import { IssuesController } from './controllers/issues.controller';
import { LabelsController } from './controllers/labels.controller';
import { ProjectsController } from './controllers/projects.controller';
import { RelationsController } from './controllers/relations.controller';
import { TeamTemplatesController } from './controllers/team-templates.controller';
import { TrackerWebhooksController } from './controllers/webhooks.controller';
import { TrackerGateway } from './gateways/tracker.gateway';
import { ActivityRecorderService } from './services/activity-recorder.service';
import { AttachmentsService } from './services/attachments.service';
import { CommentsService } from './services/comments.service';
import { CyclesService } from './services/cycles.service';
import { IntakeService } from './services/intake.service';
import { IssueMeetingsService } from './services/issue-meetings.service';
import { IssuesService } from './services/issues.service';
import { LabelsService } from './services/labels.service';
import { ProjectsService } from './services/projects.service';
import { RelationsService } from './services/relations.service';
import { TrackerEmitterService } from './services/tracker-emitter.service';
import { TrackerEventsService } from './services/tracker-events.service';
import { WebhookDispatcher } from './services/webhook-dispatcher.service';
import { WebhookSigner } from './services/webhook-signer.service';
import { WebhooksService } from './services/webhooks.service';
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
  ],
  providers: [
    ActivityRecorderService,
    ProjectsService,
    IssuesService,
    CyclesService,
    IntakeService,
    CommentsService,
    LabelsService,
    WebhooksService,
    RelationsService,
    AttachmentsService,
    IssueMeetingsService,
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
  ],
})
export class TrackerModule {}
