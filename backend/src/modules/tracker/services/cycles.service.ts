import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Cycle } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateCycleDto } from '../dto/cycles/create-cycle.dto';
import type {
  CompleteCycleResult,
  CycleResponseDto,
  ListCyclesResponse,
} from '../dto/cycles/cycle-response.dto';
import type { UpdateCycleDto } from '../dto/cycles/update-cycle.dto';
import type { ListIssuesResponse } from '../dto/issues/issue-response.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

/**
 * CyclesService — циклы («неделя работы» / спринт). Поддерживает
 * автоматический rollover незакрытых задач при завершении цикла в
 * следующий по startDate цикл.
 */
@Injectable()
export class CyclesService {
  private readonly logger = new Logger(CyclesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(WebhookDispatcher)
    private readonly webhooks: WebhookDispatcher,
  ) {}

  /** Создать цикл в проекте. Доступ: project_admin / project_manager. */
  async create(
    projectId: string,
    dto: CreateCycleDto,
    tenantId: string,
    _userId: string,
  ): Promise<CycleResponseDto> {
    await this.projects.requireProject(projectId, tenantId);
    const cycle = await this.prisma.cycle.create({
      data: {
        tenantId,
        projectId,
        name: dto.name,
        startDate: dto.startDate,
        endDate: dto.endDate,
        ownedById: dto.ownedById ?? null,
        description: dto.description ?? null,
        timezone: dto.timezone,
      },
    });
    const response = this.toResponse(cycle);
    this.events.publishCycleCreated(response, tenantId);
    void this.webhooks
      .dispatch(tenantId, 'cycle.created', { cycle: response })
      .catch((e) => {
        this.logger.warn(
          { cycleId: cycle.id, err: e instanceof Error ? e.message : String(e) },
          'cycle.created webhook dispatch failed',
        );
      });
    return response;
  }

  /** Список циклов проекта. */
  async findAll(
    projectId: string,
    tenantId: string,
  ): Promise<ListCyclesResponse> {
    await this.projects.requireProject(projectId, tenantId);
    const items = await this.prisma.cycle.findMany({
      where: { projectId, tenantId },
      orderBy: [{ startDate: 'desc' }],
    });
    return { items: items.map((c) => this.toResponse(c)), total: items.length };
  }

  /** Получить цикл по id. */
  async findById(id: string, tenantId: string): Promise<CycleResponseDto> {
    const c = await this.requireCycle(id, tenantId);
    return this.toResponse(c);
  }

  /** PATCH цикла. */
  async update(
    id: string,
    dto: UpdateCycleDto,
    tenantId: string,
    _userId: string,
  ): Promise<CycleResponseDto> {
    await this.requireCycle(id, tenantId);
    const updated = await this.prisma.cycle.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate }),
        ...(dto.ownedById !== undefined && { ownedById: dto.ownedById }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      },
    });
    return this.toResponse(updated);
  }

  /**
   * Завершить цикл. Auto-rollover: все Issue в этом цикле, чей state.category
   * не = 'completed' и не = 'cancelled', переносятся в следующий по startDate
   * цикл проекта (если есть). Каждый перенос — отдельная IssueActivity
   * verb='moved_from_cycle' с metadata.fromCycleId/.toCycleId.
   */
  async complete(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<CompleteCycleResult> {
    const cycle = await this.requireCycle(id, tenantId);
    if (cycle.completedAt) {
      // Идемпотентно: уже завершён.
      return { cycleId: id, movedIssueCount: 0, rolledOverTo: null };
    }
    // Найдём следующий цикл этого проекта (по startDate > current.startDate).
    const nextCycle = await this.prisma.cycle.findFirst({
      where: {
        projectId: cycle.projectId,
        tenantId,
        startDate: { gt: cycle.startDate },
        completedAt: null,
      },
      orderBy: [{ startDate: 'asc' }],
    });
    const rolledOverTo = nextCycle?.id ?? null;

    const movedIssueCount = await this.prisma.$transaction(async (tx) => {
      const incompleteIssues = await tx.issue.findMany({
        where: {
          cycleId: id,
          tenantId,
          deletedAt: null,
          OR: [
            { state: null },
            { state: { category: { notIn: ['completed', 'cancelled'] } } },
          ],
        },
        select: { id: true },
      });
      if (incompleteIssues.length > 0 && rolledOverTo) {
        await tx.issue.updateMany({
          where: { id: { in: incompleteIssues.map((i) => i.id) } },
          data: { cycleId: rolledOverTo },
        });
        for (const i of incompleteIssues) {
          await this.activity.record({
            tenantId,
            issueId: i.id,
            actorUserId: userId,
            actorType: 'user',
            verb: 'moved_from_cycle',
            field: 'cycleId',
            oldValue: id,
            newValue: rolledOverTo,
            metadata: { reason: 'cycle_completed_autorollover' },
            tx,
          });
        }
      }
      await tx.cycle.update({
        where: { id },
        data: { completedAt: new Date() },
      });
      return rolledOverTo ? incompleteIssues.length : 0;
    });

    // Перечитать чтобы взять свежий completedAt + progressSnapshot.
    const updated = await this.prisma.cycle.findUnique({ where: { id } });
    if (updated) {
      const updatedResponse = this.toResponse(updated);
      this.events.publishCycleProgressUpdated(updatedResponse, tenantId);
      this.events.publishCycleCompleted({
        cycleId: id,
        projectId: cycle.projectId,
        tenantId,
        movedIssueCount,
        rolledOverTo,
      });
      void this.webhooks
        .dispatch(tenantId, 'cycle.completed', {
          cycle: updatedResponse,
          movedIssueCount,
          rolledOverTo,
        })
        .catch((e) => {
          this.logger.warn(
            { cycleId: id, err: e instanceof Error ? e.message : String(e) },
            'cycle.completed webhook dispatch failed',
          );
        });
    }

    return { cycleId: id, movedIssueCount, rolledOverTo };
  }

  /** Найти задачи в цикле (используется фильтром IssuesService). */
  async findIssues(
    cycleId: string,
    tenantId: string,
  ): Promise<ListIssuesResponse> {
    const cycle = await this.requireCycle(cycleId, tenantId);
    return this.issues.findAll(cycle.projectId, tenantId, {
      cycleId,
      includeArchived: false,
      includeDeleted: false,
      page: 1,
      limit: 100,
    });
  }

  /** Проверка существования + tenant. */
  async requireCycle(id: string, tenantId: string): Promise<Cycle> {
    const c = await this.prisma.cycle.findFirst({
      where: { id, tenantId },
    });
    if (!c) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'cycle_not_found', message: 'Цикл не найден' },
      });
    }
    return c;
  }

  private toResponse(c: Cycle): CycleResponseDto {
    return {
      id: c.id,
      tenantId: c.tenantId,
      projectId: c.projectId,
      name: c.name,
      startDate: c.startDate.toISOString(),
      endDate: c.endDate.toISOString(),
      ownedById: c.ownedById,
      description: c.description,
      progressSnapshot: (c.progressSnapshot as Prisma.JsonValue | null) ?? null,
      version: c.version,
      timezone: c.timezone,
      completedAt: c.completedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

}
