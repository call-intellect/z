import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type Cycle } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateCycleDto } from '../dto/cycles/create-cycle.dto';
import type {
  CompleteCycleResult,
  CycleResponseDto,
  ListCyclesResponse,
} from '../dto/cycles/cycle-response.dto';
import type { UpdateCycleDto } from '../dto/cycles/update-cycle.dto';
import type { ListIssuesResponse } from '../dto/issues/issue-response.dto';
import { detectProjectScopeKind } from '../utils/scope-detection';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

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
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  async create(
    projectId: string,
    dto: CreateCycleDto,
    tenantId: string,
    _userId: string,
  ): Promise<CycleResponseDto> {
    const project = await this.projects.requireProject(projectId, tenantId);
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
    void this.webhooks.dispatch(tenantId, 'cycle.created', { cycle: response }).catch((e) => {
      this.logger.warn(
        { cycleId: cycle.id, err: e instanceof Error ? e.message : String(e) },
        'cycle.created webhook dispatch failed',
      );
    });
    try {
      this.metrics?.incCycleCreated({
        tenant: tenantId,
        scopeKind: detectProjectScopeKind(project),
      });
    } catch {}
    return response;
  }

  async findAll(projectId: string, tenantId: string): Promise<ListCyclesResponse> {
    await this.projects.requireProject(projectId, tenantId);
    const items = await this.prisma.cycle.findMany({
      where: { projectId, tenantId },
      orderBy: [{ startDate: 'desc' }],
    });
    return { items: items.map((c) => this.toResponse(c)), total: items.length };
  }

  async findById(id: string, tenantId: string): Promise<CycleResponseDto> {
    const c = await this.requireCycle(id, tenantId);
    return this.toResponse(c);
  }

  async update(
    id: string,
    dto: UpdateCycleDto,
    tenantId: string,
    _userId: string,
  ): Promise<CycleResponseDto> {
    await this.requireCycle(id, tenantId);
    if (dto.primaryGoalId !== undefined && dto.primaryGoalId !== null) {
      const goal = await this.prisma.goal.findFirst({
        where: { id: dto.primaryGoalId, tenantId },
        select: { id: true },
      });
      if (!goal) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'goal_not_found', message: 'Цель не найдена' },
        });
      }
    }
    const updated = await this.prisma.cycle.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate }),
        ...(dto.ownedById !== undefined && { ownedById: dto.ownedById }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.primaryGoalId !== undefined && {
          primaryGoalId: dto.primaryGoalId,
        }),
      },
    });
    return this.toResponse(updated);
  }

  async complete(id: string, tenantId: string, userId: string): Promise<CompleteCycleResult> {
    const cycle = await this.requireCycle(id, tenantId);
    if (cycle.completedAt) {
      return { cycleId: id, movedIssueCount: 0, rolledOverTo: null };
    }

    const { movedIssueCount, rolledOverTo } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `cycle-complete:${id}`,
      );
      const fresh = await tx.cycle.findUnique({
        where: { id },
        select: {
          id: true,
          projectId: true,
          startDate: true,
          completedAt: true,
        },
      });
      if (!fresh || fresh.completedAt) {
        return { movedIssueCount: 0, rolledOverTo: null };
      }
      const nextCycle = await tx.cycle.findFirst({
        where: {
          projectId: fresh.projectId,
          tenantId,
          startDate: { gt: fresh.startDate },
          completedAt: null,
        },
        orderBy: [{ startDate: 'asc' }],
      });
      const rolledOverTo = nextCycle?.id ?? null;
      const incompleteIssues = await tx.issue.findMany({
        where: {
          cycleId: id,
          tenantId,
          deletedAt: null,
          OR: [{ state: null }, { state: { category: { notIn: ['completed', 'cancelled'] } } }],
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
      return {
        movedIssueCount: rolledOverTo ? incompleteIssues.length : 0,
        rolledOverTo,
      };
    });

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
    try {
      this.metrics?.incCycleCompleted({ tenant: tenantId });
    } catch {}
    try {
      this.eventEmitter?.emit('cycle.review_requested', {
        cycleId: id,
        tenantId,
        reason: 'cycle_completed',
      });
    } catch (err) {
      this.logger.debug(
        {
          cycleId: id,
          err: err instanceof Error ? err.message : String(err),
        },
        'cycles.complete: emit cycle.review_requested failed (best-effort)',
      );
    }

    return { cycleId: id, movedIssueCount, rolledOverTo };
  }

  async findIssues(cycleId: string, tenantId: string): Promise<ListIssuesResponse> {
    const cycle = await this.requireCycle(cycleId, tenantId);
    return this.issues.findAll(cycle.projectId, tenantId, {
      cycleId,
      includeArchived: false,
      includeDeleted: false,
      includeChildrenCount: false,
      page: 1,
      limit: 100,
    });
  }

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
      primaryGoalId: c.primaryGoalId,
      completedAt: c.completedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
