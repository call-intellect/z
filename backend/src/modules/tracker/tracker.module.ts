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
import { WebhooksService } from './services/webhooks.service';

/**
 * TrackerModule (Sprint 1, B1-1.3 + B1-1.4).
 *
 * Sprint 1 закрывает: модели данных + базовый CRUD REST + IssueActivity
 * recorder + RBAC. WebSocket events / Idempotency middleware / BullMQ-доставка
 * webhook'ов / Ingest в knowledge-core / TrackerEventEmitter — Sprint 2-3.
 *
 * Зависимости (через @Global модули):
 *   - PrismaModule (явно ниже для ясности).
 *   - RbacModule (@Global) — RbacService + TenantGuard.
 *   - AuthModule (@Global) — CookieAuthGuard + CurrentUser декоратор.
 *
 * Эндпоинты — под глобальным префиксом `/api/v1` (см. main.ts).
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
  ],
  exports: [
    // Экспортируется только то, что нужно другим модулям. Все services не
    // экспортируем — снаружи модуль доступен через REST API. Исключения:
    //   - IssuesService — будет нужен `Specialist3X/intake-adapter` (Sprint 2-3).
    //   - ActivityRecorderService — может пригодиться AI-агентам в Sprint 3
    //     (запись активности от ai_agent при автоматических действиях).
    IssuesService,
    ActivityRecorderService,
  ],
})
export class TrackerModule {}
