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
import { generateProjectIdentifier, generateProjectSlug } from '../utils/translit';
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

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    dto: CreateProjectDto,
    tenantId: string,
    userId: string,
  ): Promise<ProjectResponseDto> {
    if (dto.slug) {
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
    }

    const runCreate = (): Promise<Project> =>
      this.prisma.$transaction(async (tx): Promise<Project> => {
        const slug = dto.slug ?? (await generateProjectSlug(dto.name, tenantId, tx));
        const identifier =
          dto.identifier ?? (await generateProjectIdentifier(dto.name, tenantId, tx));
        const created = await tx.project.create({
          data: {
            tenantId,
            slug,
            identifier,
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
            customerCardId: dto.customerCardId ?? null,
            vendorId: dto.vendorId ?? null,
            subjectPersonId: dto.subjectPersonId ?? null,
            departmentId: dto.departmentId ?? null,
          },
        });
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
        await tx.projectMember.create({
          data: { projectId: created.id, userId, role: 20 },
        });
        await tx.board.create({
          data: {
            tenantId,
            projectId: created.id,
            name: 'Доска',
            color: '#5EEAD4',
            sequence: 0,
            isDefault: true,
          },
        });
        if (defaultStateId) {
          return tx.project.update({
            where: { id: created.id },
            data: { defaultStateId },
          });
        }
        return created;
      });

    let project: Project;
    try {
      project = await runCreate();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        if (!dto.slug) {
          project = await runCreate();
        } else {
          throw new ConflictException({
            ok: false,
            error: { code: 'project_slug_taken', message: 'Slug проекта уже занят' },
          });
        }
      } else {
        throw err;
      }
    }

    return this.toResponse(project);
  }

  static readonly INBOX_PROJECT_NAME = 'Входящие';

  async ensureInboxProjectId(tenantId: string): Promise<string | null> {
    const findExisting = (): Promise<{ id: string } | null> =>
      this.prisma.project.findFirst({
        where: {
          tenantId,
          name: ProjectsService.INBOX_PROJECT_NAME,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    const existing = await findExisting();
    if (existing) return existing.id;
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    const ownerId = org?.ownerId ?? null;
    if (!ownerId) return null;
    try {
      const created = await this.create(
        {
          name: ProjectsService.INBOX_PROJECT_NAME,
          description:
            'Задачи из внешних каналов без определённого проекта. Создан Корой автоматически (авто-приём входящих).',
          network: 0,
          timezone: 'Europe/Moscow',
          cycleViewEnabled: true,
          intakeViewEnabled: true,
          gantViewEnabled: false,
          timeTrackingEnabled: false,
        },
        tenantId,
        ownerId,
      );
      return created.id;
    } catch {
      const retry = await findExisting();
      return retry?.id ?? null;
    }
  }

  async findAll(tenantId: string, query: ListProjectsQuery): Promise<ListProjectsResponse> {
    const where: Prisma.ProjectWhereInput = {
      tenantId,
      deletedAt: null,
      systemGenerated: false,
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

  async findById(id: string, tenantId: string): Promise<ProjectResponseDto> {
    const p = await this.requireProject(id, tenantId);
    return this.toResponse(p);
  }

  async findBySlug(slug: string, tenantId: string): Promise<ProjectResponseDto> {
    const p = await this.prisma.project.findFirst({
      where: { slug, tenantId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'project_not_found', message: 'Проект не найден' },
      });
    }
    return this.toResponse(p);
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    tenantId: string,
    _userId: string,
  ): Promise<ProjectResponseDto> {
    const current = await this.requireProject(id, tenantId);

    const finalScope = {
      customerCardId:
        dto.customerCardId !== undefined ? dto.customerCardId : current.customerCardId,
      vendorId: dto.vendorId !== undefined ? dto.vendorId : current.vendorId,
      subjectPersonId:
        dto.subjectPersonId !== undefined ? dto.subjectPersonId : current.subjectPersonId,
      departmentId: dto.departmentId !== undefined ? dto.departmentId : current.departmentId,
    };
    const filled = Object.values(finalScope).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (filled.length > 1) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'project_scope_conflict',
          message:
            'У проекта-спринта может быть только одна привязка (клиент / поставщик / сотрудник / отдел) или ни одной.',
        },
      });
    }

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
        ...(dto.customerCardId !== undefined && { customerCardId: dto.customerCardId }),
        ...(dto.vendorId !== undefined && { vendorId: dto.vendorId }),
        ...(dto.subjectPersonId !== undefined && { subjectPersonId: dto.subjectPersonId }),
        ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
      },
    });
    return this.toResponse(updated);
  }

  async archive(id: string, tenantId: string, _userId: string): Promise<ProjectResponseDto> {
    await this.requireProject(id, tenantId);
    const updated = await this.prisma.project.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return this.toResponse(updated);
  }

  async unarchive(id: string, tenantId: string, _userId: string): Promise<ProjectResponseDto> {
    await this.requireProject(id, tenantId);
    const updated = await this.prisma.project.update({
      where: { id },
      data: { archivedAt: null },
    });
    return this.toResponse(updated);
  }

  async softDelete(id: string, tenantId: string): Promise<{ ok: true }> {
    await this.requireProject(id, tenantId);
    await this.prisma.project.update({
      where: { id },
      data: { deletedAt: new Date(), archivedAt: new Date() },
    });
    return { ok: true };
  }

  async listMembers(projectId: string, tenantId: string): Promise<ProjectMemberDto[]> {
    await this.requireProject(projectId, tenantId);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { joinedAt: 'asc' },
    });
    const userIds = members.map((m) => m.userId);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => {
      const u = byId.get(m.userId);
      return this.toMemberResponse(m, u?.name ?? null, u?.email ?? null);
    });
  }

  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
    tenantId: string,
    _invitedByUserId: string,
  ): Promise<ProjectMemberDto> {
    await this.requireProject(projectId, tenantId);
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

  async removeMember(projectId: string, userId: string, tenantId: string): Promise<{ ok: true }> {
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
      customerCardId: p.customerCardId,
      vendorId: p.vendorId,
      subjectPersonId: p.subjectPersonId,
      departmentId: p.departmentId,
    };
  }

  private toMemberResponse(
    m: ProjectMember,
    displayName: string | null = null,
    email: string | null = null,
  ): ProjectMemberDto {
    return {
      id: m.id,
      projectId: m.projectId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      displayName,
      email,
    };
  }
}
