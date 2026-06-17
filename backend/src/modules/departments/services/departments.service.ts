import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  BatchCreateDepartmentsDto,
  CreateDepartmentDto,
  DepartmentDto,
  DepartmentListItemDto,
  MergeDepartmentResultDto,
  UpdateDepartmentDto,
} from '../dto/departments.dto';

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async list(args: {
    tenantId: string;
    q?: string;
    includeDeleted: boolean;
    limit: number;
  }): Promise<{ items: DepartmentListItemDto[]; total: number }> {
    const where: Prisma.DepartmentWhereInput = {
      tenantId: args.tenantId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      ...(args.q ? { name: { contains: args.q, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: args.limit,
      }),
      this.prisma.department.count({ where }),
    ]);
    const counts = await this.countAttachments(rows.map((d) => d.id));
    return {
      items: rows.map((d) =>
        this.toListItem(d, counts.get(d.id)?.roles ?? 0, counts.get(d.id)?.children ?? 0),
      ),
      total,
    };
  }

  async get(args: { tenantId: string; id: string }): Promise<DepartmentDto> {
    const dep = await this.prisma.department.findUnique({
      where: { id: args.id },
    });
    if (!dep || dep.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'department_not_found', message: 'Отдел не найден' },
      });
    }
    const counts = await this.countAttachments([dep.id]);
    const c = counts.get(dep.id);
    return this.toListItem(dep, c?.roles ?? 0, c?.children ?? 0);
  }

  private async countAttachments(
    departmentIds: string[],
  ): Promise<Map<string, { roles: number; children: number }>> {
    const result = new Map<string, { roles: number; children: number }>();
    if (departmentIds.length === 0) return result;
    const [roleCounts, childCounts] = await Promise.all([
      this.prisma.role.groupBy({
        by: ['departmentId'],
        where: { departmentId: { in: departmentIds }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.department.groupBy({
        by: ['parentDepartmentId'],
        where: {
          parentDepartmentId: { in: departmentIds },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
    ]);
    for (const id of departmentIds) {
      result.set(id, { roles: 0, children: 0 });
    }
    for (const r of roleCounts) {
      if (!r.departmentId) continue;
      const cur = result.get(r.departmentId) ?? { roles: 0, children: 0 };
      cur.roles = r._count._all;
      result.set(r.departmentId, cur);
    }
    for (const c of childCounts) {
      if (!c.parentDepartmentId) continue;
      const cur = result.get(c.parentDepartmentId) ?? { roles: 0, children: 0 };
      cur.children = c._count._all;
      result.set(c.parentDepartmentId, cur);
    }
    return result;
  }

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateDepartmentDto;
  }): Promise<DepartmentDto> {
    if (args.body.parentDepartmentId) {
      await this.assertParentExists(args.tenantId, args.body.parentDepartmentId);
    }
    try {
      const created = await this.prisma.department.create({
        data: {
          tenantId: args.tenantId,
          name: args.body.name,
          parentDepartmentId: args.body.parentDepartmentId ?? null,
        },
      });
      void this.audit.log({
        userId: args.userId,
        action: 'department.created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          name: created.name,
          parentDepartmentId: created.parentDepartmentId,
        },
      });
      void this.prisma.org.updateMany({
        where: { id: args.tenantId, departmentsCompletedAt: null },
        data: { departmentsCompletedAt: new Date() },
      });

      return this.toListItem(created, 0, 0);
    } catch (err) {
      this.handleUniqueViolation(err, args.body.name);
      throw err;
    }
  }

  async createBatch(args: {
    tenantId: string;
    userId: string;
    body: BatchCreateDepartmentsDto;
  }): Promise<{ items: DepartmentDto[]; created: number; skipped: number }> {
    const items: DepartmentDto[] = [];
    let skipped = 0;
    for (const it of args.body.items) {
      try {
        items.push(await this.create({ tenantId: args.tenantId, userId: args.userId, body: it }));
      } catch (err) {
        if (err instanceof ConflictException) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
    return { items, created: items.length, skipped };
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateDepartmentDto;
  }): Promise<DepartmentDto> {
    const existing = await this.prisma.department.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'department_not_found', message: 'Отдел не найден' },
      });
    }
    if (args.body.parentDepartmentId !== undefined && args.body.parentDepartmentId !== null) {
      if (args.body.parentDepartmentId === args.id) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'department_self_parent',
            message: 'Отдел не может быть родителем самого себя',
          },
        });
      }
      await this.assertParentExists(args.tenantId, args.body.parentDepartmentId);
    }
    const data: Prisma.DepartmentUpdateInput = {};
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.parentDepartmentId !== undefined) {
      if (args.body.parentDepartmentId === null) {
        data.parent = { disconnect: true };
      } else {
        data.parent = { connect: { id: args.body.parentDepartmentId } };
      }
    }
    try {
      const updated = await this.prisma.department.update({
        where: { id: args.id },
        data,
      });
      void this.audit.log({
        userId: args.userId,
        action: 'department.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });
      const counts = await this.countAttachments([updated.id]);
      const c = counts.get(updated.id);
      return this.toListItem(updated, c?.roles ?? 0, c?.children ?? 0);
    } catch (err) {
      this.handleUniqueViolation(err, args.body.name);
      throw err;
    }
  }

  async setHead(args: {
    tenantId: string;
    userId: string;
    id: string;
    headPersonId: string | null;
  }): Promise<DepartmentDto> {
    const existing = await this.prisma.department.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'department_not_found', message: 'Отдел не найден' },
      });
    }
    if (existing.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_deleted',
          message: 'Нельзя назначить главу удалённому отделу',
        },
      });
    }
    if (args.headPersonId !== null) {
      const person = await this.prisma.person.findUnique({
        where: { id: args.headPersonId },
        select: {
          id: true,
          tenantId: true,
          relationship: true,
          deletedAt: true,
        },
      });
      if (!person || person.tenantId !== args.tenantId || person.deletedAt !== null) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'head_person_not_found',
            message: 'Сотрудник не найден в этой организации',
          },
        });
      }
      if (person.relationship !== 'employee') {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'head_person_not_employee',
            message: 'Главой отдела может быть только сотрудник организации',
          },
        });
      }
    }
    const updated = await this.prisma.department.update({
      where: { id: args.id },
      data: { headPersonId: args.headPersonId },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'department.head_changed',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        headPersonId: args.headPersonId,
        previousHeadPersonId: existing.headPersonId,
      },
    });
    const counts = await this.countAttachments([updated.id]);
    const c = counts.get(updated.id);
    return this.toListItem(updated, c?.roles ?? 0, c?.children ?? 0);
  }

  async mergeDepartments(args: {
    tenantId: string;
    sourceId: string;
    targetId: string;
    byUserId: string;
  }): Promise<MergeDepartmentResultDto> {
    const { tenantId, sourceId, targetId } = args;

    if (sourceId === targetId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_merge_self',
          message: 'Нельзя слить отдел сам с собой',
        },
      });
    }

    const [source, target] = await Promise.all([
      this.prisma.department.findUnique({ where: { id: sourceId } }),
      this.prisma.department.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || source.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'department_not_found',
          message: 'Отдел-источник не найден',
        },
      });
    }
    if (!target || target.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'department_not_found',
          message: 'Отдел-приёмник не найден',
        },
      });
    }
    if (source.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_already_deleted',
          message: 'Отдел-источник уже удалён — слияние невозможно',
        },
      });
    }
    if (target.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_target_deleted',
          message: 'Отдел-приёмник удалён — выберите активный отдел',
        },
      });
    }

    await this.assertNotDescendant(tenantId, sourceId, targetId);

    const result = await this.prisma.$transaction(async (tx) => {
      const roles = await tx.role.updateMany({
        where: { tenantId, departmentId: sourceId },
        data: { departmentId: targetId },
      });

      const appointments = await tx.appointment.updateMany({
        where: { tenantId, departmentId: sourceId },
        data: { departmentId: targetId },
      });

      const projects = await tx.project.updateMany({
        where: { tenantId, departmentId: sourceId },
        data: { departmentId: targetId },
      });

      const persons = await tx.person.updateMany({
        where: { tenantId, primaryDepartmentId: sourceId },
        data: { primaryDepartmentId: targetId },
      });

      const childDepartments = await tx.department.updateMany({
        where: { tenantId, parentDepartmentId: sourceId },
        data: { parentDepartmentId: targetId },
      });

      const sourceDomainLinks = await tx.departmentDomainLink.findMany({
        where: { departmentId: sourceId },
        select: { id: true, domainId: true },
      });
      let movedDomainLinks = 0;
      if (sourceDomainLinks.length > 0) {
        const targetLinks = await tx.departmentDomainLink.findMany({
          where: { departmentId: targetId },
          select: { domainId: true },
        });
        const targetDomainIds = new Set(targetLinks.map((l) => l.domainId));
        for (const link of sourceDomainLinks) {
          if (targetDomainIds.has(link.domainId)) {
            await tx.departmentDomainLink.delete({ where: { id: link.id } });
          } else {
            await tx.departmentDomainLink.update({
              where: { id: link.id },
              data: { departmentId: targetId },
            });
            movedDomainLinks += 1;
          }
        }
      }

      const metrics = await tx.metric.updateMany({
        where: { tenantId, attachedToDepartmentId: sourceId },
        data: { attachedToDepartmentId: targetId },
      });

      const interactions = await tx.interaction.updateMany({
        where: { tenantId, counterpartDepartmentId: sourceId },
        data: { counterpartDepartmentId: targetId },
      });

      const orgUnits = await tx.orgUnit.updateMany({
        where: { tenantId, parentDepartmentId: sourceId },
        data: { parentDepartmentId: targetId },
      });

      let movedEntity = false;
      if (source.entityId && !target.entityId) {
        await tx.department.update({
          where: { id: sourceId },
          data: { entityId: null },
        });
        await tx.department.update({
          where: { id: targetId },
          data: { entityId: source.entityId },
        });
        movedEntity = true;
      }

      if (source.headPersonId && !target.headPersonId) {
        await tx.department.update({
          where: { id: targetId },
          data: { headPersonId: source.headPersonId },
        });
      }

      const now = new Date();
      await tx.department.update({
        where: { id: sourceId },
        data: { deletedAt: now },
      });

      const updatedTarget = await tx.department.findUniqueOrThrow({
        where: { id: targetId },
      });

      return {
        target: updatedTarget,
        moved: {
          roles: roles.count,
          appointments: appointments.count,
          projects: projects.count,
          persons: persons.count,
          childDepartments: childDepartments.count,
          domainLinks: movedDomainLinks,
          metrics: metrics.count,
          interactions: interactions.count,
          orgUnits: orgUnits.count,
          entity: movedEntity ? 1 : 0,
        },
      };
    });

    void this.audit.log({
      userId: args.byUserId,
      action: 'department.merged',
      resourceId: sourceId,
      metadata: {
        tenantId,
        sourceId,
        targetId,
        moved: result.moved,
      },
    });
    this.logger.log(
      {
        tenantId,
        sourceId,
        targetId,
        byUserId: args.byUserId,
        moved: result.moved,
      },
      'departments: слияние отделов применено',
    );

    const counts = await this.countAttachments([result.target.id]);
    const c = counts.get(result.target.id);
    return {
      ok: true,
      target: this.toListItem(result.target, c?.roles ?? 0, c?.children ?? 0),
      moved: result.moved,
    };
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.department.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'department_not_found', message: 'Отдел не найден' },
      });
    }
    if (existing.deletedAt) {
      return {
        id: existing.id,
        deletedAt: existing.deletedAt.toISOString(),
      };
    }
    const [activeRoles, activeChildren] = await Promise.all([
      this.prisma.role.count({
        where: { departmentId: args.id, deletedAt: null },
      }),
      this.prisma.department.count({
        where: { parentDepartmentId: args.id, deletedAt: null },
      }),
    ]);
    if (activeRoles > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_has_active_roles',
          message: 'У отдела есть активные должности — удалите/перенесите их сначала',
        },
      });
    }
    if (activeChildren > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_has_children',
          message: 'У отдела есть дочерние отделы — удалите/перенесите их сначала',
        },
      });
    }
    const now = new Date();
    const updated = await this.prisma.department.update({
      where: { id: args.id },
      data: { deletedAt: now },
      select: { id: true, deletedAt: true },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'department.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return {
      id: updated.id,
      deletedAt: (updated.deletedAt ?? now).toISOString(),
    };
  }

  private async assertNotDescendant(
    tenantId: string,
    ancestorId: string,
    candidateId: string,
  ): Promise<void> {
    let currentId: string | null = candidateId;
    const visited = new Set<string>();
    const MAX_DEPTH = 1000;
    for (let i = 0; i < MAX_DEPTH && currentId; i += 1) {
      if (currentId === ancestorId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'department_merge_cycle',
            message: 'Нельзя слить отдел в его собственный дочерний отдел — образуется цикл',
          },
        });
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const node: { parentDepartmentId: string | null } | null =
        await this.prisma.department.findFirst({
          where: { id: currentId, tenantId },
          select: { parentDepartmentId: true },
        });
      currentId = node?.parentDepartmentId ?? null;
    }
  }

  private async assertParentExists(tenantId: string, parentId: string): Promise<void> {
    const parent = await this.prisma.department.findUnique({
      where: { id: parentId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!parent || parent.tenantId !== tenantId || parent.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_department_not_found',
          message: 'Родительский отдел не найден или удалён',
        },
      });
    }
  }

  private handleUniqueViolation(err: unknown, name: string | undefined): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'department_name_taken',
          message: `Отдел с именем «${name ?? ''}» уже существует`,
        },
      });
    }
  }

  private toListItem(
    d: {
      id: string;
      name: string;
      parentDepartmentId: string | null;
      headPersonId: string | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    },
    rolesCount: number,
    childrenCount: number,
  ): DepartmentListItemDto {
    return {
      id: d.id,
      name: d.name,
      parentDepartmentId: d.parentDepartmentId,
      headPersonId: d.headPersonId,
      rolesCount,
      childrenCount,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
    };
  }
}
