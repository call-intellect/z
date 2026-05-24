import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Issue } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateIssueDto } from '../dto/issues/create-issue.dto';
import type {
  IssueActivityDto,
  IssueResponseDto,
  IssueVersionDto,
  ListIssuesResponse,
} from '../dto/issues/issue-response.dto';
import type { ListIssuesQuery } from '../dto/issues/list-issues-query.dto';
import type { TransitionIssueStateDto } from '../dto/issues/transition-state.dto';
import type { UpdateIssueDto } from '../dto/issues/update-issue.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { ProjectsService } from './projects.service';

/**
 * IssuesService — ядро трекера. Создание / обновление / переходы статусов /
 * комментарии-связи / лента активности. Все мутации пишутся в IssueActivity
 * через ActivityRecorderService (видимое аудиторное наследие = вход для второго мозга).
 *
 * Доступ: проверяется в контроллере через RbacService.canRead/canWrite('issue').
 * Tenant-scope обязателен на всех методах.
 */
@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  /**
   * Создать задачу. Атомарно: генерирует sequenceId (max+1 в проекте),
   * identifier=`{project.identifier}-{sequenceId}`, проставляет defaultStateId,
   * создаёт IssueAssignee/IssueLabel, пишет IssueActivity verb='created'.
   */
  async create(
    projectId: string,
    dto: CreateIssueDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const project = await this.projects.requireProject(projectId, tenantId);
    // Если stateId не передан — используем defaultStateId проекта.
    const stateId = dto.stateId ?? project.defaultStateId ?? null;
    if (dto.stateId) await this.requireStateInProject(dto.stateId, projectId);

    const issue = await this.prisma.$transaction(async (tx) => {
      // Атомарный sequenceId: max+1 per project (узкая зона гонок снимется
      // unique-constraint'ом @@unique([projectId, sequenceId]) — при retry-ит
      // upstream через идемпотентность Sprint 2).
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
          dueDate: dto.dueDate ?? null,
          cycleId: dto.cycleId ?? null,
          goalId: dto.goalId ?? null,
          externalSource: dto.externalSource ?? null,
          externalId: dto.externalId ?? null,
          createdById: userId,
          createdManually: true,
        },
      });

      // Assignees.
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
      // Labels — проверим, что они принадлежат tenant'у (защита от cross-tenant).
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

      // IssueActivity verb='created'.
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

    return this.assemble(issue.id, tenantId);
  }

  /** Список задач проекта с фильтрами. */
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
    return {
      items: items.map((i) => this.toResponseFromInclude(i)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Найти задачу по id (глобальный id) + проверка tenant. */
  async findById(id: string, tenantId: string): Promise<IssueResponseDto> {
    return this.assemble(id, tenantId);
  }

  /** Найти задачу по identifier (`KORA-123`) + tenant. */
  async findByIdentifier(
    identifier: string,
    tenantId: string,
  ): Promise<IssueResponseDto> {
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

  /**
   * PATCH задачи. Для каждого изменённого поля пишет отдельную строку
   * IssueActivity verb='updated' (field/oldValue/newValue). state-смена через
   * PATCH тоже фиксируется отдельной записью verb='status_changed'.
   */
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
    await this.prisma.$transaction(async (tx) => {
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
        activities.push({
          verb: field === 'stateId' ? 'status_changed' : 'updated',
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
      trackField('dueDate', dto.dueDate ?? undefined);
      trackField('cycleId', dto.cycleId ?? undefined);
      trackField('goalId', dto.goalId ?? undefined);

      if (Object.keys(data).length === 0) {
        return;
      }
      // Если state поменялся и новая категория = completed — проставим completedAt.
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
        await this.activity.record({
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
      }
    });
    return this.assemble(id, tenantId);
  }

  /** Soft-delete через deletedAt. Пишет IssueActivity verb='deleted'. */
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
    return { ok: true };
  }

  /**
   * Сменить статус задачи отдельным action'ом (predпочтительнее PATCH stateId).
   * Доступ: assignee / project_manager / admin (контроллер проверяет RBAC).
   */
  async transitionState(
    id: string,
    dto: TransitionIssueStateDto,
    tenantId: string,
    userId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(id, tenantId);
    if (existing.stateId === dto.stateId) {
      // Идемпотентно: уже в нужном состоянии.
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
      await this.activity.record({
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
    });
    return this.assemble(id, tenantId);
  }

  /** Добавить исполнителя. IssueActivity verb='assigned'. */
  async addAssignee(
    issueId: string,
    assigneeUserId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
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
    return { ok: true };
  }

  /** Удалить исполнителя. */
  async removeAssignee(
    issueId: string,
    assigneeUserId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
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
    return { ok: true };
  }

  /** Добавить метку. */
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
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
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

  /** Удалить метку. */
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

  /** Подписаться на задачу (получать уведомления). */
  async subscribe(
    issueId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    try {
      await this.prisma.issueSubscriber.create({ data: { issueId, userId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Уже подписан — идемпотентно ok.
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  /** Отписаться. Идемпотентно. */
  async unsubscribe(
    issueId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(issueId, tenantId);
    await this.prisma.issueSubscriber.deleteMany({ where: { issueId, userId } });
    return { ok: true };
  }

  /** Связать задачу с целью (Goal). IssueActivity verb='goal_linked'. */
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
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issueId }, data: { goalId } });
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'goal_linked',
        field: 'goalId',
        oldValue: existing.goalId,
        newValue: goalId,
        tx,
      });
    });
    return this.assemble(issueId, tenantId);
  }

  /** Отвязать задачу от цели. */
  async unlinkGoal(
    issueId: string,
    tenantId: string,
    actorUserId: string,
  ): Promise<IssueResponseDto> {
    const existing = await this.requireIssue(issueId, tenantId);
    if (!existing.goalId) return this.assemble(issueId, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: issueId }, data: { goalId: null } });
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId,
        actorType: 'user',
        verb: 'goal_unlinked',
        field: 'goalId',
        oldValue: existing.goalId,
        newValue: null,
        tx,
      });
    });
    return this.assemble(issueId, tenantId);
  }

  /** Список IssueActivity для задачи (DESC по epoch). */
  async getActivity(
    issueId: string,
    tenantId: string,
  ): Promise<IssueActivityDto[]> {
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

  /** Список IssueVersion (исторические снимки) для задачи. */
  async getVersions(
    issueId: string,
    tenantId: string,
  ): Promise<IssueVersionDto[]> {
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

  // ── internal ──

  /** Проверка существования + tenant ownership. */
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

  private async requireStateInProject(
    stateId: string,
    projectId: string,
  ): Promise<void> {
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

  /** Собрать ResponseDto по id (включая assignees + labels). */
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
    };
  }

  /** Сравнение значений «как в Prisma» — Date через timestamp, остальное ===. */
  private equalsLoose(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof Date && typeof b === 'string') {
      return a.getTime() === new Date(b).getTime();
    }
    return a === b;
  }
}
