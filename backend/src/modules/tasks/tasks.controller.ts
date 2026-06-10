import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import {
  type CreateTaskDto,
  CreateTaskSchema,
} from './dto/create-task.dto';
import {
  type BulkTasksDto,
  BulkTasksSchema,
  type ListTasksQuery,
  ListTasksQuerySchema,
  type SendTaskDto,
  SendTaskSchema,
} from './dto/list-tasks.dto';
import {
  type UpdateTaskDto,
  UpdateTaskSchema,
} from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/**
 * @deprecated Sprint 3 B1-3.3 — legacy API задач (action items из встреч).
 *
 * Эти эндпоинты остаются для обратной совместимости старого фронтенда (1-2 фазы),
 * но новый код должен использовать трекерный API: `/api/v1/projects/:projectId/issues`
 * и `/api/v1/issues/:id`. Миграция legacy `Task` → `Issue` выполняется скриптом
 * `backend/scripts/migrate-task-to-issue.ts` (виртуальный проект «Из встреч» per Org,
 * `externalSource='meeting_legacy'`).
 *
 *   `GET /api/v1/tasks`                          — все задачи юзера
 *   `GET /api/v1/meetings/:meetingId/tasks`      — задачи одной встречи
 *   `POST /api/v1/meetings/:meetingId/tasks`     — ручное создание
 *   `PATCH /api/v1/tasks/:id`                    — обновить
 *   `DELETE /api/v1/tasks/:id`                   — удалить (hard, у Task нет deletedAt)
 *   `POST /api/v1/tasks/:id/send`                — отправить в IntegrationDestination
 *   `POST /api/v1/tasks/bulk`                    — массовая операция
 */
@ApiTags('legacy / tasks (deprecated)')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get('tasks')
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — список задач пользователя',
    description:
      'Используй `GET /api/v1/projects/:projectId/issues` (трекер). Эндпоинт остаётся для legacy фронтенда.',
  })
  async listAll(
    @Query(new ZodValidationPipe(ListTasksQuerySchema)) query: ListTasksQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    items: ReturnType<TasksController['mapTask']>[];
    page: number;
    limit: number;
    total: number;
  }> {
    const result = await this.tasks.list(user.id, query);
    return {
      items: result.items.map((t) => this.mapTask(t)),
      page: query.page,
      limit: query.limit,
      total: result.total,
    };
  }

  @Get('meetings/:meetingId/tasks')
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — задачи одной встречи',
    description:
      'Используй `GET /api/v1/issues?linkedMeetingId=:meetingId` (трекер).',
  })
  async listByMeeting(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<TasksController['mapTask']>[] }> {
    const items = await this.tasks.listByMeeting(meetingId, user.id);
    return { items: items.map((t) => this.mapTask(t)) };
  }

  @Post('meetings/:meetingId/tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — ручное создание задачи в контексте встречи',
    description:
      'Используй `POST /api/v1/projects/:projectId/issues` с `linkedMeetingIds=[meetingId]` (трекер).',
  })
  async create(
    @Param('meetingId') meetingId: string,
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: CreateTaskDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<TasksController['mapTask']>> {
    const task = await this.tasks.create(meetingId, user.id, body);
    return this.mapTask(task);
  }

  @Patch('tasks/:id')
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — обновление задачи',
    description: 'Используй `PATCH /api/v1/issues/:id` (трекер).',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) body: UpdateTaskDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<TasksController['mapTask']>> {
    const task = await this.tasks.update(id, user.id, body);
    return this.mapTask(task);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — удаление задачи',
    description: 'Используй `DELETE /api/v1/issues/:id` (soft-delete в трекере).',
  })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.tasks.delete(id, user.id);
  }

  @Post('tasks/:id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — отправка задачи во внешнюю интеграцию',
    description:
      'В трекере отправка во внешние системы реализуется через webhooks `/api/v1/tracker/webhooks/*`.',
  })
  async send(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendTaskSchema)) body: SendTaskDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.tasks.send(id, user.id, body.destinationId);
  }

  @Post('tasks/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    deprecated: true,
    summary: 'DEPRECATED — массовая операция над задачами',
    description: 'В трекере массовые операции — `POST /api/v1/issues/bulk` (Sprint 3+).',
  })
  async bulk(
    @Body(new ZodValidationPipe(BulkTasksSchema)) body: BulkTasksDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ affected: number; action: BulkTasksDto['action'] }> {
    return this.tasks.bulk(user.id, body);
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private mapTask(t: {
    id: string;
    meetingId: string;
    userId: string;
    title: string;
    description: string | null;
    status: string;
    assigneeRaw: string | null;
    assigneeUserId: string | null;
    dueDate: Date | null;
    sourceStartMs: number | null;
    sourceEndMs: number | null;
    sourceQuote: string | null;
    confidence: number | null;
    createdManually: boolean;
    extractorVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): {
    id: string;
    meetingId: string;
    title: string;
    description: string | null;
    status: string;
    assigneeRaw: string | null;
    assigneeUserId: string | null;
    dueDate: string | null;
    sourceStartMs: number | null;
    sourceEndMs: number | null;
    sourceQuote: string | null;
    confidence: number | null;
    createdManually: boolean;
    /**
     * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — метка генератора задачи.
     * `'fast'` = новый `MeetingReportFastWorker` (приоритет в UI пользователя),
     * `'v2'` = историческое значение снятого v2-стека (генератор удалён
     *          2026-06-10; старые строки в БД могут его нести),
     * `null` = legacy `tasks-extract.worker`.
     */
    extractorVersion: string | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: t.id,
      meetingId: t.meetingId,
      title: t.title,
      description: t.description,
      status: t.status,
      assigneeRaw: t.assigneeRaw,
      // ТЗ 2026-05-25 hard-participant-identification — отдаём userId
      // ответственного, когда AI смог жёстко сопоставить. UI использует для
      // фильтра «мои задачи» и аватара.
      assigneeUserId: t.assigneeUserId,
      dueDate: t.dueDate?.toISOString() ?? null,
      sourceStartMs: t.sourceStartMs,
      sourceEndMs: t.sourceEndMs,
      sourceQuote: t.sourceQuote,
      confidence: t.confidence,
      createdManually: t.createdManually,
      extractorVersion: t.extractorVersion ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
