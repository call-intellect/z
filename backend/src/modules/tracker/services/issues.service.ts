import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type Issue } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { CreateIssueDto } from '../dto/issues/create-issue.dto';
import type {
  IssueActivityDto,
  IssueAiSuggestionsDto,
  IssueChildResponseDto,
  IssueChildrenResponseDto,
  IssueResponseDto,
  IssueVersionDto,
  ListIssuesResponse,
  MyInboxCountDto,
  MyInboxResponseDto,
} from '../dto/issues/issue-response.dto';
import type { ListIssuesQuery } from '../dto/issues/list-issues-query.dto';
import type { MyInboxQuery } from '../dto/issues/my-inbox-query.dto';
import type { TransitionIssueStateDto } from '../dto/issues/transition-state.dto';
import type { UpdateIssueDto } from '../dto/issues/update-issue.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { BoardsService } from './boards.service';
import { HolidayService } from './holiday.service';
import { IssueEmbedQueueService } from './issue-embed-queue.service';
import { IssueGoalSuggestService } from './issue-goal-suggest.service';
import { IssueInferFieldsService } from './issue-infer-fields.service';
import { ProjectsService } from './projects.service';
import { TrackerEmitterService } from './tracker-emitter.service';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(WebhookDispatcher)
    private readonly webhooks: WebhookDispatcher,
    @Inject(TrackerEmitterService)
    private readonly emitter: TrackerEmitterService,
    @Optional()
    @Inject(IssueEmbedQueueService)
    private readonly embedQueue?: IssueEmbedQueueService,
    @Optional()
    @Inject(IssueInferFieldsService)
    private readonly inferFieldsSvc?: IssueInferFieldsService,
    @Optional()
    @Inject(IssueGoalSuggestService)
    private readonly goalSuggestSvc?: IssueGoalSuggestService,
    @Optional()
    @Inject(HolidayService)
    private readonly holidayService?: HolidayService,
    @Optional()
    @Inject(BoardsService)
    private readonly boards?: BoardsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async create(
    projectId: string,
    dto: CreateIssueDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const project = await this.projects.requireProject(projectId, tenantId);
    const stateId = dto.stateId ?? project.defaultStateId ?? null;
    if (dto.stateId) await this.requireStateInProject(dto.stateId, projectId);

    const boardId = await this.resolveBoardIdForCreate({
      tenantId,
      projectId,
      explicitBoardId: dto.boardId ?? null,
    });

    const adjustedDueDate = await this.maybeAdjustDueDate({
      tenantId,
      dueDate: dto.dueDate ?? null,
      respectHolidays: dto.respectHolidays,
    });

    const issue = await this.prisma.$transaction(async (tx) => {
      if (dto.parentId) {
        await this.validateParentForIssue({
          candidateParentId: dto.parentId,
          projectId,
          tenantId,
          currentIssueId: null,
          tx,
        });
      }

      const maxRow = await tx.issue.aggregate({
        where: { projectId },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      const identifier = `${project.identifier}-${sequenceId}`;

      const created = await tx.issue.create({
        data: {
          tenantId,
          projectId,
          identifier,
          sequenceId,
          title: dto.title,
          description: dto.description ?? null,
          descriptionHtml: dto.descriptionHtml ?? null,
          descriptionStripped: dto.descriptionStripped ?? null,
          priority: dto.priority,
          stateId,
          parentId: dto.parentId ?? null,
          estimatePoints: dto.estimatePoints ?? null,
          sortOrder: dto.sortOrder,
          startDate: dto.startDate ?? null,
          dueDate: adjustedDueDate,
          cycleId: dto.cycleId ?? null,
          goalId: dto.goalId ?? null,
          boardId,
          ...(dto.sourceBlockIds && dto.sourceBlockIds.length > 0
            ? { sourceBlockIds: dto.sourceBlockIds }
            : {}),
          externalSource: dto.externalSource ?? null,
          externalId: dto.externalId ?? null,
          createdById: userId,
          createdManually: true,
        },
      });

      if (dto.assigneeUserIds.length > 0) {
        await tx.issueAssignee.createMany({
          data: dto.assigneeUserIds.map((uid) => ({
            issueId: created.id,
            userId: uid,
            assignedById: userId,
          })),
          skipDuplicates: true,
        });
      }
      if (dto.labelIds.length > 0) {
        const valid = await tx.label.findMany({
          where: { id: { in: dto.labelIds }, tenantId },
          select: { id: true },
        });
        if (valid.length !== dto.labelIds.length) {
          throw new BadRequestException({
            ok: false,
            error: {
              code: 'invalid_label_ids',
              message: 'Часть меток не принадлежит организации или не найдена',
            },
          });
        }
        await tx.issueLabel.createMany({
          data: dto.labelIds.map((labelId) => ({ issueId: created.id, labelId })),
          skipDuplicates: true,
        });
      }

      await this.activity.record({
        tenantId,
        issueId: created.id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'created',
        newValue: { title: created.title, identifier: created.identifier },
        tx,
      });
      return created;
    });

    const response = await this.assemble(issue.id, tenantId);
    if (issue.parentId) {
      try {
        this.metrics?.incSubtaskCreated({
          tenant: tenantId,
          project: projectId,
        });
      } catch (e) {
        this.logger.warn(
          {
            issueId: issue.id,
            err: e instanceof Error ? e.message : String(e),
          },
          'subtasks_created_total inc failed (best-effort)',
        );
      }
    }
    this.events.publishIssueCreated(response, tenantId);
    this.emitter.emitIssueCreated(issue, userId);
    void this.enqueueEmbed(tenantId, issue.id, null);
    void this.webhooks.dispatch(tenantId, 'issue.created', { issue: response }).catch((e) => {
      this.logger.warn(
        { issueId: response.id, err: e instanceof Error ? e.message : String(e) },
        'issue.created webhook dispatch failed',
      );
    });

    if (dto.inferSuggestions) {
      const aiSuggestions = await this.collectAiSuggestions(issue.id, tenantId);
      if (aiSuggestions) {
        return { ...response, aiSuggestions };
      }
    }
    return response;
  }

  private async collectAiSuggestions(
    issueId: string,
    tenantId: string,
  ): Promise<IssueAiSuggestionsDto | null> {
    if (!this.inferFieldsSvc && !this.goalSuggestSvc) {
      return null;
    }
    const [fieldsResult, goalResult] = await Promise.all([
      this.inferFieldsSvc
        ? this.inferFieldsSvc.inferFields({ tenantId, issueId })
        : Promise.resolve(null),
      this.goalSuggestSvc
        ? this.goalSuggestSvc.suggestGoal({ tenantId, issueId })
        : Promise.resolve(null),
    ]);
    if (!fieldsResult && !goalResult) {
      return null;
    }
    return {
      fields: fieldsResult
        ? {
            suggestedAssigneeId: fieldsResult.suggestedAssigneeId,
            suggestedDueDate: fieldsResult.suggestedDueDate,
            suggestedPriority: fieldsResult.suggestedPriority,
            suggestedGoalId: fieldsResult.suggestedGoalId,
            suggestedLabels: fieldsResult.suggestedLabels,
            confidence: fieldsResult.confidence,
            meetsThreshold: fieldsResult.meetsThreshold,
            reasoning: fieldsResult.reasoning,
          }
        : null,
      goal: goalResult
        ? {
            goalId: goalResult.goalId,
            confidence: goalResult.confidence,
            source: goalResult.source,
          }
        : null,
    };
  }

  async findAll(
    projectId: string,
    tenantId: string,
    query: ListIssuesQuery,
  ): Promise<ListIssuesResponse> {
    await this.projects.requireProject(projectId, tenantId);
    const where: Prisma.IssueWhereInput = { tenantId, projectId };
    if (!query.includeDeleted) where.deletedAt = null;
    if (!query.includeArchived) where.archivedAt = null;
    if (query.stateId) where.stateId = query.stateId;
    if (query.stateCategory) {
      where.state = { category: query.stateCategory };
    }
    if (query.priority) where.priority = query.priority;
    if (query.parentId) where.parentId = query.parentId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.goalId) where.goalId = query.goalId;
    if (query.boardId) where.boardId = query.boardId;
    if (query.assigneeUserId) {
      where.assignees = { some: { userId: query.assigneeUserId } };
    }
    if (query.labelId) {
      where.labels = { some: { labelId: query.labelId } };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { descriptionStripped: { contains: query.q, mode: 'insensitive' } },
        { identifier: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
        include: {
          assignees: { select: { userId: true } },
          labels: { select: { labelId: true } },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);
    let childrenCountByParent: Map<string, number> | null = null;
    if (query.includeChildrenCount && items.length > 0) {
      const parentIds = items.map((i) => i.id);
      const grouped = await this.prisma.issue.groupBy({
        by: ['parentId'],
        where: {
          tenantId,
          parentId: { in: parentIds },
          deletedAt: null,
        },
        _count: { _all: true },
      });
      childrenCountByParent = new Map();
      for (const row of grouped) {
        if (row.parentId) {
          childrenCountByParent.set(row.parentId, row._count._all);
        }
      }
    }
    return {
      items: items.map((i) => {
        const base = this.toResponseFromInclude(i);
        if (childrenCountByParent) {
          return { ...base, childrenCount: childrenCountByParent.get(i.id) ?? 0 };
        }
        return base;
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findChildren(issueId: string, tenantId: string): Promise<IssueChildrenResponseDto> {
    await this.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issue.findMany({
      where: { tenantId, parentId: issueId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        assignees: { select: { userId: true } },
        state: { select: { category: true } },
      },
    });
    let grandchildrenByParent: Map<string, number> | null = null;
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const grouped = await this.prisma.issue.groupBy({
        by: ['parentId'],
        where: { tenantId, parentId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      });
      grandchildrenByParent = new Map();
      for (const row of grouped) {
        if (row.parentId) {
          grandchildrenByParent.set(row.parentId, row._count._all);
        }
      }
    }
    const items: IssueChildResponseDto[] = rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      title: r.title,
      stateId: r.stateId,
      stateCategory: (r.state?.category as IssueChildResponseDto['stateCategory']) ?? null,
      priority: r.priority,
      assigneeUserIds: r.assignees.map((a) => a.userId),
      dueDate: r.dueDate?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      childrenCount: grandchildrenByParent?.get(r.id) ?? 0,
      sortOrder: r.sortOrder,
    }));
    return { items, total: items.length };
  }

  async findMyInbox(
    tenantId: string,
    userId: string,
    query: MyInboxQuery,
  ): Promise<MyInboxResponseDto> {
    const where: Prisma.IssueWhereInput = {
      tenantId,
      assignees: { some: { userId } },
    };
    if (!query.includeDeleted) where.deletedAt = null;
    if (!query.includeArchived) where.archivedAt = null;
    if (query.stateId) where.stateId = query.stateId;
    if (query.stateCategory) where.state = { category: query.stateCategory };
    if (query.priority) where.priority = query.priority;
    if (query.projectId) where.projectId = query.projectId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.labelId) where.labels = { some: { labelId: query.labelId } };
    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {
        ...(query.dueBefore && { lte: query.dueBefore }),
        ...(query.dueAfter && { gte: query.dueAfter }),
      };
    }
    if (query.cursor) {
      where.id = { lt: query.cursor };
    }
    const rows = await this.prisma.issue.findMany({
      where,
      orderBy: [{ id: 'desc' }],
      take: query.limit + 1,
      include: {
        assignees: { select: { userId: true } },
        labels: { select: { labelId: true } },
      },
    });
    const hasMore = rows.length > query.limit;
    const pageItems = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? (pageItems[pageItems.length - 1]?.id ?? null) : null;
    return {
      items: pageItems.map((i) => this.toResponseFromInclude(i)),
      nextCursor,
      limit: query.limit,
    };
  }

  async countMyInbox(tenantId: string, userId: string): Promise<MyInboxCountDto> {
    const where: Prisma.IssueWhereInput = {
      tenantId,
      assignees: { some: { userId } },
      deletedAt: null,
      archivedAt: null,
    };
    const total = await this.prisma.issue.count({ where });
    return { total, unread: total };
  }

  async listOpenForAssignee(args: { tenantId: string; userId: string; limit: number }): Promise<{
    items: Array<{
      identifier: string;
      title: string;
      stateName: string | null;
      dueDate: Date | null;
    }>;
    total: number;
  }> {
    const where: Prisma.IssueWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
      archivedAt: null,
      assignees: { some: { userId: args.userId } },
      OR: [{ state: { category: { notIn: ['completed', 'cancelled'] } } }, { stateId: null }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: args.limit,
        select: {
          identifier: true,
          title: true,
          dueDate: true,
          state: { select: { name: true } },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        identifier: r.identifier,
        title: r.title,
        stateName: r.state?.name ?? null,
        dueDate: r.dueDate,
      })),
      total,
    };
  }

  async findById(id: string, tenantId: string): Promise<IssueResponseDto> {
    return this.assemble(id, tenantId);
  }

  async findByIdentifier(identifier: string, tenantId: string): Promise<IssueResponseDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { tenantId, identifier, deletedAt: null },
      select: { id: true },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    return this.assemble(issue.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateIssueDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(id, tenantId);
    if (dto.stateId && dto.stateId !== existing.stateId) {
      await this.requireStateInProject(dto.stateId, existing.projectId);
    }

    if (dto.boardId && dto.boardId !== existing.boardId && this.boards) {
      await this.boards.assertBoardInProject({
        boardId: dto.boardId,
        projectId: existing.projectId,
        tenantId,
      });
    }
    const adjustedDueDate =
      dto.dueDate === undefined || dto.dueDate === null
        ? dto.dueDate
        : await this.maybeAdjustDueDate({
            tenantId,
            dueDate: dto.dueDate,
            respectHolidays: dto.respectHolidays,
          });
    const changedFields: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      if (dto.parentId !== undefined && dto.parentId !== null) {
        await this.validateParentForIssue({
          candidateParentId: dto.parentId,
          projectId: existing.projectId,
          tenantId,
          currentIssueId: existing.id,
          tx,
        });
      }

      const data: Prisma.IssueUpdateInput = {};
      const activities: Array<{
        verb: string;
        field?: string;
        oldValue: unknown;
        newValue: unknown;
      }> = [];
      const trackField = <K extends keyof Issue>(
        field: K,
        nextValue: Issue[K] | undefined,
      ): void => {
        if (nextValue === undefined) return;
        const prev = existing[field];
        if (this.equalsLoose(prev, nextValue)) return;
        (data as Record<string, unknown>)[field as string] = nextValue;
        let verb: string;
        if (field === 'stateId') verb = 'status_changed';
        else if (field === 'parentId') verb = 'parent_changed';
        else verb = 'updated';
        activities.push({
          verb,
          field: String(field),
          oldValue: prev,
          newValue: nextValue,
        });
      };

      trackField('title', dto.title);
      trackField('description', dto.description ?? undefined);
      trackField('descriptionHtml', dto.descriptionHtml ?? undefined);
      trackField('descriptionStripped', dto.descriptionStripped ?? undefined);
      trackField('priority', dto.priority);
      trackField('stateId', dto.stateId ?? undefined);
      trackField('parentId', dto.parentId ?? undefined);
      trackField('estimatePoints', dto.estimatePoints ?? undefined);
      trackField('sortOrder', dto.sortOrder);
      trackField('startDate', dto.startDate ?? undefined);
      trackField('dueDate', adjustedDueDate ?? undefined);
      trackField('cycleId', dto.cycleId ?? undefined);
      trackField('goalId', dto.goalId ?? undefined);
      trackField('boardId', dto.boardId ?? undefined);

      if (Object.keys(data).length === 0) {
        return;
      }
      if (dto.stateId !== undefined && dto.stateId !== existing.stateId) {
        const newState = dto.stateId
          ? await tx.issueState.findUnique({ where: { id: dto.stateId } })
          : null;
        if (newState?.category === 'completed' && !existing.completedAt) {
          (data as Record<string, unknown>).completedAt = new Date();
        }
        if (newState?.category !== 'completed' && existing.completedAt) {
          (data as Record<string, unknown>).completedAt = null;
        }
      }
      await tx.issue.update({ where: { id }, data });
      for (const a of activities) {
        if (a.field) changedFields.push(a.field);
        const activityId = await this.activity.record({
          tenantId,
          issueId: id,
          actorUserId: userId,
          actorType: 'user',
          verb: a.verb,
          field: a.field ?? null,
          oldValue: a.oldValue,
          newValue: a.newValue,
          tx,
        });
        this.events.publishActivity({
          tenantId,
          activityId,
          issueId: id,
          verb: a.verb,
        });
      }
    });
    const response = await this.assemble(id, tenantId);
    if (changedFields.length > 0) {
      this.events.publishIssueUpdated(response, tenantId, changedFields);
      if (changedFields.includes('boardId') && dto.boardId) {
        this.events.publishIssueMovedToBoard({
          tenantId,
          projectId: existing.projectId,
          issueId: id,
          fromBoardId: existing.boardId,
          toBoardId: dto.boardId,
        });
        this.metrics?.incBoardIssueMoved({
          tenantTop: tenantTopOf(tenantId),
          fromBoard: existing.boardId ?? '',
          toBoard: dto.boardId,
        });
      }
      const textChanged =
        changedFields.includes('title') ||
        changedFields.includes('description') ||
        changedFields.includes('descriptionStripped');
      if (textChanged) {
        void this.enqueueEmbed(tenantId, id, null);
      }
      if (changedFields.includes('stateId') && dto.stateId !== undefined) {
        void this.emitStateChangeIfNeeded({
          issueId: id,
          tenantId,
          userId,
          oldStateId: existing.stateId,
          newStateId: dto.stateId,
        }).catch((e) => {
          this.logger.warn(
            { issueId: id, err: e instanceof Error ? e.message : String(e) },
            'tracker-emitter: emitStateChangeIfNeeded (update) упал — событие в knowledge-core пропущено',
          );
        });
      }
      void this.webhooks
        .dispatch(tenantId, 'issue.updated', {
          issue: response,
          changedFields,
        })
        .catch((e) => {
          this.logger.warn(
            { issueId: id, err: e instanceof Error ? e.message : String(e) },
            'issue.updated webhook dispatch failed',
          );
        });
    }
    return response;
  }

  async softDelete(id: string, tenantId: string, userId: string): Promise<{ ok: true }> {
    const existing = await this.requireIssue(id, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      await this.activity.record({
        tenantId,
        issueId: existing.id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'deleted',
        tx,
      });
    });
    this.events.publishIssueDeleted(existing.id, tenantId, existing.projectId);
    void this.webhooks
      .dispatch(tenantId, 'issue.deleted', {
        issueId: existing.id,
        projectId: existing.projectId,
      })
      .catch((e) => {
        this.logger.warn(
          { issueId: existing.id, err: e instanceof Error ? e.message : String(e) },
          'issue.deleted webhook dispatch failed',
        );
      });
    return { ok: true };
  }

  async transitionState(
    id: string,
    dto: TransitionIssueStateDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(id, tenantId);
    if (existing.stateId === dto.stateId) {
      return this.assemble(id, tenantId);
    }
    const newState = await this.prisma.issueState.findFirst({
      where: { id: dto.stateId, projectId: existing.projectId },
    });
    if (!newState) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_state_id',
          message: 'Статус не найден или принадлежит другому проекту',
        },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.IssueUpdateInput = {
        state: { connect: { id: dto.stateId } },
      };
      if (newState.category === 'completed' && !existing.completedAt) {
        data.completedAt = new Date();
      } else if (newState.category !== 'completed' && existing.completedAt) {
        data.completedAt = null;
      }
      await tx.issue.update({ where: { id }, data });
      const activityId = await this.activity.record({
        tenantId,
        issueId: id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'status_changed',
        field: 'stateId',
        oldValue: existing.stateId,
        newValue: dto.stateId,
        metadata: dto.reason ? { reason: dto.reason } : null,
        tx,
      });
      this.events.publishActivity({
        tenantId,
        activityId,
        issueId: id,
        verb: 'status_changed',
      });
    });
    const response = await this.assemble(id, tenantId);
    this.events.publishIssueUpdated(response, tenantId, ['stateId']);
    void this.emitStateChangeIfNeeded({
      issueId: id,
      tenantId,
      userId,
      oldStateId: existing.stateId,
      newStateId: dto.stateId,
      reason: dto.reason ?? null,
    }).catch((e) => {
      this.logger.warn(
        { issueId: id, err: e instanceof Error ? e.message : String(e) },
        'tracker-emitter: emitStateChangeIfNeeded (transition) упал — событие в knowledge-core пропущено',
      );
    });
    void this.webhooks
      .dispatch(tenantId, 'issue.updated', {
        issue: response,
        changedFields: ['stateId'],
      })
      .catch((e) => {
        this.logger.warn(
          { issueId: id, err: e instanceof Error ? e.message : String(e) },
          'issue.updated (transition) webhook dispatch failed',
        );
      });
    return response;
  }

  async moveToProject(
    issueId: string,
    targetProjectId: string,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);

    if (existing.projectId === targetProjectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'same_project',
          message: 'Задача уже находится в этом проекте',
        },
      });
    }

    const target = await this.projects.requireProject(targetProjectId, tenantId);
    if (target.archivedAt !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'target_project_archived',
          message: 'Целевой проект архивирован — перенос невозможен',
        },
      });
    }

    if (existing.parentId !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_move_issue_with_subtasks',
          message: 'Нельзя перенести подзадачу — сначала сделайте её самостоятельной',
        },
      });
    }
    const childrenCount = await this.prisma.issue.count({
      where: { parentId: issueId, deletedAt: null },
    });
    if (childrenCount > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_move_issue_with_subtasks',
          message: 'Нельзя перенести задачу с подзадачами — перенесите или отвяжите подзадачи',
        },
      });
    }

    const currentCategory = existing.stateId
      ? ((
          await this.prisma.issueState.findUnique({
            where: { id: existing.stateId },
            select: { category: true },
          })
        )?.category ?? null)
      : null;
    let targetStateId: string | null = target.defaultStateId ?? null;
    if (currentCategory) {
      const matched = await this.prisma.issueState.findFirst({
        where: { projectId: targetProjectId, category: currentCategory },
        orderBy: { sequence: 'asc' },
        select: { id: true },
      });
      if (matched) targetStateId = matched.id;
    }

    let targetBoardId: string | null = null;
    if (this.boards) {
      try {
        targetBoardId = await this.boards.resolveDefaultBoardId({
          tenantId,
          projectId: targetProjectId,
        });
      } catch (err) {
        this.logger.warn(
          {
            issueId,
            targetProjectId,
            err: err instanceof Error ? err.message : String(err),
          },
          'IssuesService.moveToProject: default-доска целевого проекта не разрешилась — переносим без boardId',
        );
        targetBoardId = null;
      }
    }

    const oldIdentifier = existing.identifier;
    let newIdentifier = oldIdentifier;
    await this.prisma.$transaction(async (tx) => {
      const maxRow = await tx.issue.aggregate({
        where: { projectId: targetProjectId },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      newIdentifier = `${target.identifier}-${sequenceId}`;

      await tx.issue.update({
        where: { id: issueId },
        data: {
          projectId: targetProjectId,
          sequenceId,
          identifier: newIdentifier,
          stateId: targetStateId,
          boardId: targetBoardId,
          cycleId: null,
        },
      });

      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'moved_to_project',
        field: 'projectId',
        oldValue: existing.projectId,
        newValue: targetProjectId,
        metadata: { oldIdentifier, newIdentifier },
        tx,
      });
    });

    const response = await this.assemble(issueId, tenantId);
    this.events.publishIssueUpdated(response, tenantId, ['projectId', 'identifier']);
    this.events.publishIssueMovedToProject({
      tenantId,
      issueId,
      fromProjectId: existing.projectId,
      toProjectId: targetProjectId,
      oldIdentifier,
      newIdentifier,
    });
    try {
      this.metrics?.incIssueMovedToProject({ tenantTop: tenantTopOf(tenantId) });
    } catch (e) {
      this.logger.warn(
        { issueId, err: e instanceof Error ? e.message : String(e) },
        'issue_moved_to_project_total inc failed (best-effort)',
      );
    }
    void this.webhooks
      .dispatch(tenantId, 'issue.updated', {
        issue: response,
        changedFields: ['projectId', 'identifier'],
      })
      .catch((e) => {
        this.logger.warn(
          { issueId, err: e instanceof Error ? e.message : String(e) },
          'issue.updated (move) webhook dispatch failed',
        );
      });
    return response;
  }

  async addAssignee(
    issueId: string,
    assigneeUserId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(issueId, tenantId);
    const existing = await this.prisma.issueAssignee.findUnique({
      where: { issueId_userId: { issueId, userId: assigneeUserId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'assignee_already_added',
          message: 'Пользователь уже назначен исполнителем',
        },
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.issueAssignee.create({
        data: { issueId, userId: assigneeUserId, assignedById: actorUserId },
      });
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'assigned',
        newValue: { userId: assigneeUserId },
        tx,
      });
    });
    this.emitter.emitIssueAssigneeChanged({
      issue,
      actorUserId,
      action: 'added',
      assigneeUserId,
    });
    return { ok: true };
  }

  async removeAssignee(
    issueId: string,
    assigneeUserId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(issueId, tenantId);
    const deleted = await this.prisma.issueAssignee.deleteMany({
      where: { issueId, userId: assigneeUserId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'assignee_not_found',
          message: 'Исполнитель не найден на задаче',
        },
      });
    }
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId,
      actorType: 'user',
      verb: 'unassigned',
      oldValue: { userId: assigneeUserId },
    });
    this.emitter.emitIssueAssigneeChanged({
      issue,
      actorUserId,
      action: 'removed',
      assigneeUserId,
    });
    return { ok: true };
  }

  async addLabel(
    issueId: string,
    labelId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, tenantId },
      select: { id: true },
    });
    if (!label) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_label_id', message: 'Метка не найдена в организации' },
      });
    }
    try {
      await this.prisma.issueLabel.create({ data: { issueId, labelId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: { code: 'label_already_added', message: 'Метка уже добавлена' },
        });
      }
      throw e;
    }
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId,
      actorType: 'user',
      verb: 'label_added',
      newValue: { labelId },
    });
    return { ok: true };
  }

  async removeLabel(
    issueId: string,
    labelId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    const deleted = await this.prisma.issueLabel.deleteMany({
      where: { issueId, labelId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'label_not_on_issue', message: 'Метка не найдена на задаче' },
      });
    }
    await this.activity.record({
      tenantId,
      issueId,
      actorUserId,
      actorType: 'user',
      verb: 'label_removed',
      oldValue: { labelId },
    });
    return { ok: true };
  }

  async subscribe(issueId: string, userId: string, tenantId: string): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    try {
      await this.prisma.issueSubscriber.create({ data: { issueId, userId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  async unsubscribe(issueId: string, userId: string, tenantId: string): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    await this.prisma.issueSubscriber.deleteMany({ where: { issueId, userId } });
    return { ok: true };
  }

  async linkGoal(
    issueId: string,
    goalId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      select: { id: true },
    });
    if (!goal) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    let activityId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issueId }, data: { goalId } });
      activityId = await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'goal_linked',
        field: 'goalId',
        oldValue: existing.goalId,
        newValue: goalId,
        metadata: { goalId },
        tx,
      });
    });
    const response = await this.assemble(issueId, tenantId);
    this.events.publishIssueUpdated(response, tenantId, ['goalId']);
    if (activityId) {
      this.events.publishActivity({
        tenantId,
        activityId,
        issueId,
        verb: 'goal_linked',
      });
    }
    return response;
  }

  async unlinkGoal(
    issueId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);
    if (!existing.goalId) return this.assemble(issueId, tenantId);
    const oldGoalId = existing.goalId;
    let activityId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issueId }, data: { goalId: null } });
      activityId = await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'goal_unlinked',
        field: 'goalId',
        oldValue: oldGoalId,
        newValue: null,
        metadata: { goalId: oldGoalId },
        tx,
      });
    });
    const response = await this.assemble(issueId, tenantId);
    this.events.publishIssueUpdated(response, tenantId, ['goalId']);
    if (activityId) {
      this.events.publishActivity({
        tenantId,
        activityId,
        issueId,
        verb: 'goal_unlinked',
      });
    }
    return response;
  }

  async getActivity(issueId: string, tenantId: string): Promise<IssueActivityDto[]> {
    await this.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueActivity.findMany({
      where: { issueId, tenantId },
      orderBy: [{ epoch: 'desc' }],
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      issueId: r.issueId,
      actorUserId: r.actorUserId,
      actorType: r.actorType,
      agentName: r.agentName,
      verb: r.verb,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      metadata: r.metadata,
      epoch: r.epoch.toString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getVersions(issueId: string, tenantId: string): Promise<IssueVersionDto[]> {
    await this.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueVersion.findMany({
      where: { issueId },
      orderBy: [{ versionNumber: 'desc' }],
    });
    return rows.map((v) => ({
      id: v.id,
      issueId: v.issueId,
      versionNumber: v.versionNumber,
      snapshot: v.snapshot,
      createdByUserId: v.createdByUserId,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  private async emitStateChangeIfNeeded(args: {
    issueId: string;
    tenantId: string;
    userId: string;
    oldStateId: string | null;
    newStateId: string | null;
    reason?: string | null;
  }): Promise<void> {
    const fresh = await this.prisma.issue.findFirst({
      where: { id: args.issueId, tenantId: args.tenantId },
    });
    if (!fresh) return;
    const [oldState, newState] = await Promise.all([
      args.oldStateId
        ? this.prisma.issueState.findUnique({ where: { id: args.oldStateId } })
        : Promise.resolve(null),
      args.newStateId
        ? this.prisma.issueState.findUnique({ where: { id: args.newStateId } })
        : Promise.resolve(null),
    ]);
    this.emitter.emitIssueStatusChanged({
      issue: fresh,
      actorUserId: args.userId,
      oldStateId: args.oldStateId,
      newStateId: args.newStateId,
      oldStateCategory: oldState?.category ?? null,
      newStateCategory: newState?.category ?? null,
      reason: args.reason ?? null,
    });
    if (newState?.category === 'blocked') {
      this.emitter.emitIssueBlocked({
        issue: fresh,
        actorUserId: args.userId,
        newState,
        reason: args.reason ?? null,
      });
    }
    if (newState?.category === 'completed') {
      this.emitter.emitIssueCompleted({
        issue: fresh,
        actorUserId: args.userId,
        newState,
      });
    }
  }

  async requireIssue(id: string, tenantId: string): Promise<Issue> {
    const issue = await this.prisma.issue.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    return issue;
  }

  private async validateParentForIssue(args: {
    candidateParentId: string;
    projectId: string;
    tenantId: string;
    currentIssueId: string | null;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    if (args.currentIssueId !== null && args.candidateParentId === args.currentIssueId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cyclic_parent_not_allowed',
          message: 'Задача не может быть родителем самой себя',
        },
      });
    }
    const lockKeys = [args.candidateParentId];
    if (args.currentIssueId && args.currentIssueId !== args.candidateParentId) {
      lockKeys.push(args.currentIssueId);
    }
    lockKeys.sort();
    for (const key of lockKeys) {
      await args.tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }

    const parent = await args.tx.issue.findFirst({
      where: {
        id: args.candidateParentId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true, projectId: true, parentId: true },
    });
    if (!parent) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_not_found',
          message: 'Родительская задача не найдена',
        },
      });
    }
    if (parent.projectId !== args.projectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_in_different_project',
          message: 'Родительская задача в другом проекте',
        },
      });
    }
    if (parent.parentId !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'max_subtask_depth_exceeded',
          message: 'Подзадача не может быть подзадачей: глубина больше 2 запрещена',
        },
      });
    }
    if (args.currentIssueId !== null) {
      const visited = new Set<string>([args.currentIssueId]);
      let frontier: string[] = [args.currentIssueId];
      let guard = 0;
      while (frontier.length > 0 && guard < 256) {
        guard++;
        const children = await args.tx.issue.findMany({
          where: {
            tenantId: args.tenantId,
            parentId: { in: frontier },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (children.length === 0) break;
        const next: string[] = [];
        for (const c of children) {
          if (c.id === args.candidateParentId) {
            throw new BadRequestException({
              ok: false,
              error: {
                code: 'cyclic_parent_not_allowed',
                message: 'Нельзя назначить родителем потомка текущей задачи',
              },
            });
          }
          if (!visited.has(c.id)) {
            visited.add(c.id);
            next.push(c.id);
          }
        }
        frontier = next;
      }
    }
  }

  private async requireStateInProject(stateId: string, projectId: string): Promise<void> {
    const s = await this.prisma.issueState.findFirst({
      where: { id: stateId, projectId },
      select: { id: true },
    });
    if (!s) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_state_id',
          message: 'Статус не принадлежит проекту',
        },
      });
    }
  }

  private async assemble(id: string, tenantId: string): Promise<IssueResponseDto> {
    const issue = await this.prisma.issue.findFirst({
      where: { id, tenantId },
      include: {
        assignees: { select: { userId: true } },
        labels: { select: { labelId: true } },
      },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    return this.toResponseFromInclude(issue);
  }

  private toResponseFromInclude(
    issue: Issue & {
      assignees: Array<{ userId: string }>;
      labels: Array<{ labelId: string }>;
    },
  ): IssueResponseDto {
    return {
      id: issue.id,
      tenantId: issue.tenantId,
      projectId: issue.projectId,
      identifier: issue.identifier,
      sequenceId: issue.sequenceId,
      title: issue.title,
      description: issue.description,
      descriptionHtml: issue.descriptionHtml,
      descriptionStripped: issue.descriptionStripped,
      priority: issue.priority,
      stateId: issue.stateId,
      parentId: issue.parentId,
      estimatePoints: issue.estimatePoints,
      sortOrder: issue.sortOrder,
      startDate: issue.startDate?.toISOString() ?? null,
      dueDate: issue.dueDate?.toISOString() ?? null,
      completedAt: issue.completedAt?.toISOString() ?? null,
      cycleId: issue.cycleId,
      goalId: issue.goalId,
      boardId: issue.boardId,
      meetingId: issue.meetingId,
      linkedMeetingIds: issue.linkedMeetingIds,
      sourceBlockIds: issue.sourceBlockIds,
      confidence: issue.confidence?.toString() ?? null,
      createdManually: issue.createdManually,
      externalSource: issue.externalSource,
      externalId: issue.externalId,
      entityId: issue.entityId,
      createdById: issue.createdById,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      archivedAt: issue.archivedAt?.toISOString() ?? null,
      deletedAt: issue.deletedAt?.toISOString() ?? null,
      assigneeUserIds: issue.assignees.map((a) => a.userId),
      labelIds: issue.labels.map((l) => l.labelId),
      checklistTotalCount: issue.checklistTotalCount,
      checklistDoneCount: issue.checklistDoneCount,
    };
  }

  private async resolveBoardIdForCreate(args: {
    tenantId: string;
    projectId: string;
    explicitBoardId: string | null;
  }): Promise<string | null> {
    if (!this.boards) {
      return args.explicitBoardId;
    }
    if (args.explicitBoardId) {
      await this.boards.assertBoardInProject({
        boardId: args.explicitBoardId,
        projectId: args.projectId,
        tenantId: args.tenantId,
      });
      return args.explicitBoardId;
    }
    try {
      return await this.boards.resolveDefaultBoardId({
        tenantId: args.tenantId,
        projectId: args.projectId,
      });
    } catch (err) {
      this.logger.warn(
        {
          projectId: args.projectId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssuesService.resolveBoardIdForCreate: default-доска не разрешилась — создаём задачу без boardId',
      );
      return null;
    }
  }

  private async enqueueEmbed(
    tenantId: string,
    issueId: string,
    embeddingHash: string | null,
  ): Promise<void> {
    if (!this.embedQueue) return;
    try {
      await this.embedQueue.enqueue({ tenantId, issueId, embeddingHash });
    } catch (err) {
      this.logger.warn(
        { issueId, err: err instanceof Error ? err.message : String(err) },
        'issue-embed: enqueue упал — embedding будет пропущен до следующего апдейта',
      );
    }
  }

  private async maybeAdjustDueDate(args: {
    tenantId: string;
    dueDate: Date | null;
    respectHolidays: boolean | undefined;
  }): Promise<Date | null> {
    if (args.dueDate === null) return null;
    if (args.respectHolidays === false) return args.dueDate;
    if (!this.holidayService) return args.dueDate;
    try {
      return await this.holidayService.adjustDueDate({
        tenantId: args.tenantId,
        dueDate: args.dueDate,
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          dueDate: args.dueDate.toISOString(),
          err: err instanceof Error ? err.message : String(err),
        },
        'IssuesService.maybeAdjustDueDate: HolidayService упал — оставляю dueDate как есть',
      );
      return args.dueDate;
    }
  }

  private equalsLoose(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof Date && typeof b === 'string') {
      return a.getTime() === new Date(b).getTime();
    }
    return a === b;
  }
}
