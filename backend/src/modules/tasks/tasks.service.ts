import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Task, TaskStatus } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';

import type { CreateTaskDto } from './dto/create-task.dto';
import type {
  BulkTasksDto,
  ListTasksQuery,
} from './dto/list-tasks.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import { TasksDispatcherService } from './tasks-dispatcher.service';
import { TasksRepository } from './tasks.repository';

/**
 * Бизнес-сервис задач (action items).
 *
 * Все операции защищены ownership-проверкой: `task.userId === currentUser.id`.
 * Для скрытия информации NotFound используется и при «нет такой задачи»,
 * и при «не ваша задача».
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TasksRepository) private readonly repo: TasksRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TasksDispatcherService) private readonly dispatcher: TasksDispatcherService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(userId: string, query: ListTasksQuery): Promise<{ items: Task[]; total: number }> {
    return this.repo.list({
      userId,
      page: query.page,
      limit: query.limit,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.meetingId !== undefined ? { meetingId: query.meetingId } : {}),
      ...(query.dueBefore !== undefined ? { dueBefore: new Date(query.dueBefore) } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
    });
  }

  async listByMeeting(meetingId: string, userId: string): Promise<Task[]> {
    await this.assertMeetingOwner(meetingId, userId);
    return this.repo.listByMeeting(meetingId, userId);
  }

  async create(meetingId: string, userId: string, dto: CreateTaskDto): Promise<Task> {
    await this.assertMeetingOwner(meetingId, userId);
    const task = await this.repo.create({
      meetingId,
      userId,
      title: dto.title,
      description: dto.description ?? null,
      assigneeRaw: dto.assigneeRaw ?? null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      createdManually: true,
    });
    this.logger.debug(`task created: ${task.id} meeting=${meetingId} user=${userId}`);
    return task;
  }

  async update(id: string, userId: string, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.repo.findById(id);
    if (!task || task.userId !== userId) {
      throw new NotFoundException('task_not_found');
    }
    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.assigneeRaw !== undefined ? { assigneeRaw: dto.assigneeRaw } : {}),
      ...(dto.dueDate !== undefined
        ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const task = await this.repo.findById(id);
    if (!task || task.userId !== userId) {
      throw new NotFoundException('task_not_found');
    }
    await this.repo.delete(id);
  }

  async send(
    id: string,
    userId: string,
    destinationId: string,
  ): Promise<{ ok: true }> {
    const task = await this.repo.findById(id);
    if (!task || task.userId !== userId) {
      throw new NotFoundException('task_not_found');
    }
    await this.dispatcher.sendTask(task, destinationId);
    await this.audit
      .log({
        action: 'task.send',
        userId,
        resourceId: id,
        metadata: { destinationId },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  async bulk(
    userId: string,
    dto: BulkTasksDto,
  ): Promise<{ affected: number; action: BulkTasksDto['action'] }> {
    const max = this.cfg.workspace.maxBulkOperationIds;
    if (dto.ids.length > max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'bulk_limit_exceeded',
          message: `Слишком много id за один раз (максимум ${max})`,
        },
      });
    }
    const uniqueIds = [...new Set(dto.ids)];

    let affected: number;
    if (dto.action === 'mark_done') {
      affected = await this.repo.bulkUpdateStatus(uniqueIds, userId, 'done' as TaskStatus);
    } else {
      affected = await this.repo.bulkDelete(uniqueIds, userId);
    }

    await this.audit
      .log({
        action: `task.bulk.${dto.action}`,
        userId,
        metadata: { count: affected, requested: uniqueIds.length },
      })
      .catch(() => undefined);

    return { affected, action: dto.action };
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private async assertMeetingOwner(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== userId) {
      throw new NotFoundException('meeting_not_found');
    }
  }
}
