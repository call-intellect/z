import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Project, type ProjectMember } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateProjectDto } from '../dto/projects/create-project.dto';
import type {
  AddProjectMemberDto,
  ListProjectsQuery,
} from '../dto/projects/list-projects-query.dto';
import type {
  ListProjectsResponse,
  ProjectMemberDto,
  ProjectResponseDto,
} from '../dto/projects/project-response.dto';
import type { UpdateProjectDto } from '../dto/projects/update-project.dto';

const DEFAULT_STATES: ReadonlyArray<{
  name: string;
  category: 'backlog' | 'started' | 'completed' | 'cancelled';
  color: string;
  sequence: number;
  isDefault: boolean;
}> = [
  { name: 'Бэклог', category: 'backlog', color: '#94A3B8', sequence: 1, isDefault: true },
  { name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2, isDefault: false },
  { name: 'Готово', category: 'completed', color: '#10B981', sequence: 3, isDefault: false },
  { name: 'Отменено', category: 'cancelled', color: '#EF4444', sequence: 4, isDefault: false },
];

/**
 * ProjectsService — управление проектами трекера: CRUD + members + дефолтные
 * IssueState. Доступно: TenantGuard + RBAC `project`.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Создать проект + 4 дефолтных IssueState + самого user как admin. Доступ: admin/owner Org. */
  async create(
    dto: CreateProjectDto,
    tenantId: string,
    userId: string,
  ): Promise<ProjectResponseDto> {
    // Проверка уникальности slug per tenant (даём явную 409).
    const existing = await this.prisma.project.findUnique({
      where: { tenantId_slug: { tenantId, slug: dto.slug } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: { code: 'project_slug_taken', message: 'Slug проекта уже занят' },
      });
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          tenantId,
          slug: dto.slug,
          identifier: dto.identifier,
          name: dto.name,
          description: dto.description ?? null,
          ownerId: userId,
          defaultAssigneeId: dto.defaultAssigneeId ?? null,
          network: dto.network,
          timezone: dto.timezone,
          cycleViewEnabled: dto.cycleViewEnabled,
          intakeViewEnabled: dto.intakeViewEnabled,
          gantViewEnabled: dto.gantViewEnabled,
          timeTrackingEnabled: dto.timeTrackingEnabled,
          teamTemplateId: dto.teamTemplateId ?? null,
        },
      });
      // Дефолтные статусы.
      const states = await tx.issueState.createManyAndReturn({
        data: DEFAULT_STATES.map((s) => ({
          tenantId,
          projectId: created.id,
          name: s.name,
          color: s.color,
          category: s.category,
          sequence: s.sequence,
          isDefault: s.isDefault,
        })),
        select: { id: true, isDefault: true },
      });
      const defaultStateId = states.find((s) => s.isDefault)?.id ?? null;
      // Сам пользователь — admin (role=20) проекта.
      await tx.projectMember.create({
        data: { projectId: created.id, userId, role: 20 },
      });
      // Зафиксировать defaultStateId (необязательно — но удобно UI).
      if (defaultStateId) {
        return tx.project.update({
          where: { id: created.id },
          data: { defaultStateId },
        });
      }
      return created;
    });

    return this.toResponse(project);
  }

  /** Список проектов tenant'а с фильтрами includeArchived/ownerId/q. */
  async findAll(
    tenantId: string,
    query: ListProjectsQuery,
  ): Promise<ListProjectsResponse> {
    const where: Prisma.ProjectWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (!query.includeArchived) where.archivedAt = null;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { slug: { contains: query.q, mode: 'insensitive' } },
        { identifier: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items: items.map((p) => this.toResponse(p)), total };
  }

  /** Найти проект по id + проверка tenant. NotFound если нет/чужой/удалён. */
  async findById(id: string, tenantId: string): Promise<ProjectResponseDto> {
    const p = await this.requireProject(id, tenantId);
    return this.toResponse(p);
  }

  /** PATCH проекта. Доступ: admin/owner Org. */
  async update(
    id: string,
    dto: UpdateProjectDto,
    tenantId: string,
    _userId: string,
  ): Promise<ProjectResponseDto> {
    await this.requireProject(id, tenantId);
    // ActivityRecorder не вызываем — Project не имеет issueId. История проектов — отдельно (Sprint 2).
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.defaultAssigneeId !== undefined && {
          defaultAssigneeId: dto.defaultAssigneeId,
        }),
        ...(dto.defaultStateId !== undefined && { defaultStateId: dto.defaultStateId }),
        ...(dto.network !== undefined && { network: dto.network }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.cycleViewEnabled !== undefined && {
          cycleViewEnabled: dto.cycleViewEnabled,
        }),
        ...(dto.intakeViewEnabled !== undefined && {
          intakeViewEnabled: dto.intakeViewEnabled,
        }),
        ...(dto.gantViewEnabled !== undefined && {
          gantViewEnabled: dto.gantViewEnabled,
        }),
        ...(dto.timeTrackingEnabled !== undefined && {
          timeTrackingEnabled: dto.timeTrackingEnabled,
        }),
      },
    });
    return this.toResponse(updated);
  }

  /** Soft-archive (archivedAt = now). Доступ: admin/owner Org. */
  async archive(id: string, tenantId: string, _userId: string): Promise<ProjectResponseDto> {
    await this.requireProject(id, tenantId);
    const updated = await this.prisma.project.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return this.toResponse(updated);
  }

  /** Снять archive. */
  async unarchive(id: string, tenantId: string, _userId: string): Promise<ProjectResponseDto> {
    await this.requireProject(id, tenantId);
    const updated = await this.prisma.project.update({
      where: { id },
      data: { archivedAt: null },
    });
    return this.toResponse(updated);
  }

  /** Soft-delete (deletedAt = now). Каскад идёт по schema (issues/cycles/states/labels — Cascade). */
  async softDelete(id: string, tenantId: string): Promise<{ ok: true }> {
    await this.requireProject(id, tenantId);
    await this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date(), archivedAt: new Date() },
    });
    return { ok: true };
  }

  /** Список членов проекта. Доступ: project member (проверяется TenantGuard + наличием membership). */
  async listMembers(projectId: string, tenantId: string): Promise<ProjectMemberDto[]> {
    await this.requireProject(projectId, tenantId);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => this.toMemberResponse(m));
  }

  /** Добавить участника. role: 20=Admin, 15=Member, 5=Guest. */
  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
    tenantId: string,
    _invitedByUserId: string,
  ): Promise<ProjectMemberDto> {
    await this.requireProject(projectId, tenantId);
    // Защита от дубликатов — отдадим явный 409.
    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: dto.userId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'project_member_exists',
          message: 'Пользователь уже добавлен в проект',
        },
      });
    }
    const created = await this.prisma.projectMember.create({
      data: { projectId, userId: dto.userId, role: dto.role },
    });
    return this.toMemberResponse(created);
  }

  /** Удалить участника. Owner проекта удалить нельзя (BadRequest). */
  async removeMember(
    projectId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    const p = await this.requireProject(projectId, tenantId);
    if (p.ownerId === userId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_remove_owner',
          message: 'Нельзя удалить владельца проекта',
        },
      });
    }
    const deleted = await this.prisma.projectMember.deleteMany({
      where: { projectId, userId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'project_member_not_found',
          message: 'Пользователь не найден в проекте',
        },
      });
    }
    return { ok: true };
  }

  /**
   * Проверка существования + tenant ownership. Возвращает Project. Кидает
   * 404 если не найден / удалён / в другом tenant'е.
   */
  async requireProject(id: string, tenantId: string): Promise<Project> {
    const p = await this.prisma.project.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'project_not_found', message: 'Проект не найден' },
      });
    }
    return p;
  }

  // ── mappers ──

  private toResponse(p: Project): ProjectResponseDto {
    return {
      id: p.id,
      tenantId: p.tenantId,
      slug: p.slug,
      identifier: p.identifier,
      name: p.name,
      description: p.description,
      ownerId: p.ownerId,
      defaultAssigneeId: p.defaultAssigneeId,
      defaultStateId: p.defaultStateId,
      network: p.network,
      timezone: p.timezone,
      cycleViewEnabled: p.cycleViewEnabled,
      intakeViewEnabled: p.intakeViewEnabled,
      gantViewEnabled: p.gantViewEnabled,
      timeTrackingEnabled: p.timeTrackingEnabled,
      teamTemplateId: p.teamTemplateId,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      deletedAt: p.deletedAt?.toISOString() ?? null,
    };
  }

  private toMemberResponse(m: ProjectMember): ProjectMemberDto {
    return {
      id: m.id,
      projectId: m.projectId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    };
  }
}
