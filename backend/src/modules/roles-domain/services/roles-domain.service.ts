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
  BatchCreateRolesDto,
  CreateRoleDto,
  ListRolesQuery,
  RoleDto,
  RoleListItemDto,
  UpdateRoleDto,
} from '../dto/roles-domain.dto';

/**
 * Сервис бизнес-должностей (Role).
 *
 * Бизнес-правила:
 *   - tenantId обязателен.
 *   - При создании Role автоматически создаётся RoleProfile(status='forming').
 *   - Связь Role→Department пишется в EntityLink (relationType='belongs_to')
 *     напрямую через Prisma. Когда GraphService будет готов — рефакторинг
 *     тривиален. fromType='role', toType='department'.
 *   - DELETE — soft. Закрываем EntityLink belongs_to (status='archived',
 *     deletedAt=now).
 */
@Injectable()
export class RolesDomainService {
  private readonly logger = new Logger(RolesDomainService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // ─────────────────────────── list / get ───────────────────────────

  async list(args: {
    tenantId: string;
    q?: string;
    departmentId?: string;
    includeDeleted: boolean;
    limit: number;
  }): Promise<{ items: RoleListItemDto[]; total: number }> {
    const where: Prisma.RoleWhereInput = {
      tenantId: args.tenantId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      ...(args.departmentId ? { departmentId: args.departmentId } : {}),
      ...(args.q
        ? { name: { contains: args.q, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: args.limit,
        include: {
          department: { select: { id: true, name: true } },
          roleProfile: { select: { status: true } },
        },
      }),
      this.prisma.role.count({ where }),
    ]);
    const counts = await this.countAttachments(rows.map((r) => r.id));
    return {
      items: rows.map((r) =>
        this.toListItem(
          r,
          r.department?.name ?? null,
          counts.get(r.id)?.persons ?? 0,
          counts.get(r.id)?.jobDescriptions ?? 0,
          r.roleProfile?.status ?? null,
        ),
      ),
      total,
    };
  }

  async get(args: { tenantId: string; id: string }): Promise<RoleDto> {
    const r = await this.prisma.role.findUnique({
      where: { id: args.id },
      include: {
        department: { select: { id: true, name: true } },
        roleProfile: { select: { status: true } },
      },
    });
    if (!r || r.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Должность не найдена' },
      });
    }
    const counts = await this.countAttachments([r.id]);
    const c = counts.get(r.id);
    return this.toListItem(
      r,
      r.department?.name ?? null,
      c?.persons ?? 0,
      c?.jobDescriptions ?? 0,
      r.roleProfile?.status ?? null,
    );
  }

  /**
   * Считаем активные PersonRole и активные JobDescription для пачки ролей
   * одним запросом каждый — взамен filtered `_count`.
   */
  private async countAttachments(
    roleIds: string[],
  ): Promise<Map<string, { persons: number; jobDescriptions: number }>> {
    const result = new Map<
      string,
      { persons: number; jobDescriptions: number }
    >();
    if (roleIds.length === 0) return result;
    for (const id of roleIds) {
      result.set(id, { persons: 0, jobDescriptions: 0 });
    }
    const [personCounts, jdCounts] = await Promise.all([
      this.prisma.personRole.groupBy({
        by: ['roleId'],
        where: { roleId: { in: roleIds }, validTo: null },
        _count: { _all: true },
      }),
      this.prisma.jobDescription.groupBy({
        by: ['roleId'],
        where: { roleId: { in: roleIds }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    for (const p of personCounts) {
      const cur = result.get(p.roleId) ?? { persons: 0, jobDescriptions: 0 };
      cur.persons = p._count._all;
      result.set(p.roleId, cur);
    }
    for (const j of jdCounts) {
      const cur = result.get(j.roleId) ?? { persons: 0, jobDescriptions: 0 };
      cur.jobDescriptions = j._count._all;
      result.set(j.roleId, cur);
    }
    return result;
  }

  // ─────────────────────────── create / update / delete ─────────────

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateRoleDto;
  }): Promise<RoleDto> {
    if (args.body.departmentId) {
      await this.assertDepartmentExists(args.tenantId, args.body.departmentId);
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            tenantId: args.tenantId,
            name: args.body.name,
            departmentId: args.body.departmentId ?? null,
            tags: args.body.tags ?? [],
          },
          include: {
            department: { select: { id: true, name: true } },
          },
        });

        // RoleProfile создаём всегда (иначе UI '/roles' будет пустой).
        await tx.roleProfile.create({
          data: {
            tenantId: args.tenantId,
            roleId: role.id,
            status: 'forming',
            summaryCache: {},
            buildVersion: 0,
          },
        });

        // EntityLink Role → Department (belongs_to) если есть department.
        if (role.departmentId) {
          await this.upsertActiveLink(tx, {
            tenantId: args.tenantId,
            fromEntityId: role.id,
            toEntityId: role.departmentId,
            fromType: 'role',
            toType: 'department',
            relationType: 'belongs_to',
            explanation: 'Должность создана в составе отдела вручную',
          });
        }

        return role;
      });

      void this.audit.log({
        userId: args.userId,
        action: 'role.created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          name: created.name,
          departmentId: created.departmentId,
        },
      });

      return this.toListItem(created, created.department?.name ?? null, 0, 0, 'forming');
    } catch (err) {
      this.handleUniqueViolation(err, args.body.name);
      throw err;
    }
  }

  async createBatch(args: {
    tenantId: string;
    userId: string;
    body: BatchCreateRolesDto;
  }): Promise<{ items: RoleDto[]; created: number; skipped: number }> {
    const items: RoleDto[] = [];
    let skipped = 0;
    for (const it of args.body.items) {
      try {
        items.push(
          await this.create({ tenantId: args.tenantId, userId: args.userId, body: it }),
        );
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
    body: UpdateRoleDto;
  }): Promise<RoleDto> {
    const existing = await this.prisma.role.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Должность не найдена' },
      });
    }
    if (
      args.body.departmentId !== undefined &&
      args.body.departmentId !== null
    ) {
      await this.assertDepartmentExists(args.tenantId, args.body.departmentId);
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const data: Prisma.RoleUpdateInput = {};
        if (args.body.name !== undefined) data.name = args.body.name;
        if (args.body.tags !== undefined) data.tags = args.body.tags;
        if (args.body.departmentId !== undefined) {
          if (args.body.departmentId === null) {
            data.department = { disconnect: true };
          } else {
            data.department = { connect: { id: args.body.departmentId } };
          }
        }

        const row = await tx.role.update({
          where: { id: args.id },
          data,
          include: {
            department: { select: { id: true, name: true } },
            roleProfile: { select: { status: true } },
          },
        });

        // EntityLink belongs_to синхронизируем если departmentId изменился.
        if (
          args.body.departmentId !== undefined &&
          args.body.departmentId !== existing.departmentId
        ) {
          // Закрываем старую belongs_to (если была).
          await tx.entityLink.updateMany({
            where: {
              tenantId: args.tenantId,
              fromEntityId: args.id,
              fromType: 'role',
              relationType: 'belongs_to',
              deletedAt: null,
            },
            data: {
              status: 'archived',
              deletedAt: new Date(),
              validTo: new Date(),
              deletedBy: args.userId,
            },
          });
          if (args.body.departmentId) {
            await this.upsertActiveLink(tx, {
              tenantId: args.tenantId,
              fromEntityId: args.id,
              toEntityId: args.body.departmentId,
              fromType: 'role',
              toType: 'department',
              relationType: 'belongs_to',
              explanation: 'Должность перенесена в другой отдел вручную',
            });
          }
        }

        return row;
      });

      void this.audit.log({
        userId: args.userId,
        action: 'role.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });

      const counts = await this.countAttachments([updated.id]);
      const c = counts.get(updated.id);
      return this.toListItem(
        updated,
        updated.department?.name ?? null,
        c?.persons ?? 0,
        c?.jobDescriptions ?? 0,
        updated.roleProfile?.status ?? null,
      );
    } catch (err) {
      this.handleUniqueViolation(err, args.body.name);
      throw err;
    }
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.role.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Должность не найдена' },
      });
    }
    if (existing.deletedAt) {
      return {
        id: existing.id,
        deletedAt: existing.deletedAt.toISOString(),
      };
    }
    const activePersons = await this.prisma.personRole.count({
      where: { roleId: args.id, validTo: null },
    });
    if (activePersons > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'role_has_active_persons',
          message:
            'На должности есть активные сотрудники — снимите назначения сначала',
        },
      });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: args.id },
        data: { deletedAt: now },
      });
      // Закрываем все исходящие/входящие EntityLink этой Role.
      await tx.entityLink.updateMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          OR: [
            { fromEntityId: args.id, fromType: 'role' },
            { toEntityId: args.id, toType: 'role' },
          ],
        },
        data: {
          status: 'archived',
          deletedAt: now,
          validTo: now,
          deletedBy: args.userId,
        },
      });
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return { id: args.id, deletedAt: now.toISOString() };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private async assertDepartmentExists(
    tenantId: string,
    departmentId: string,
  ): Promise<void> {
    const dep = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!dep || dep.tenantId !== tenantId || dep.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_not_found',
          message: 'Указанный отдел не найден или удалён',
        },
      });
    }
  }

  /**
   * Создаёт активную EntityLink или реактивирует ранее soft-deleted строку
   * с тем же composite-ключом (fromEntityId, fromType, toEntityId, toType,
   * relationType) — иначе сработала бы уникальность @@unique без deletedAt.
   */
  private async upsertActiveLink(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: string;
      fromEntityId: string;
      toEntityId: string;
      fromType: string;
      toType: string;
      relationType: 'belongs_to' | 'executes_role' | 'member_of' | 'described_by' | 'derived_from';
      explanation: string;
    },
  ): Promise<void> {
    const existing = await tx.entityLink.findFirst({
      where: {
        fromEntityId: args.fromEntityId,
        fromType: args.fromType,
        toEntityId: args.toEntityId,
        toType: args.toType,
        relationType: args.relationType,
      },
      select: { id: true, status: true, deletedAt: true },
    });
    const now = new Date();
    if (existing) {
      await tx.entityLink.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          deletedAt: null,
          deletedBy: null,
          validFrom: now,
          validTo: null,
          confidence: new Prisma.Decimal('1.000'),
          explanation: args.explanation,
          createdBy: 'manual',
        },
      });
      return;
    }
    await tx.entityLink.create({
      data: {
        tenantId: args.tenantId,
        fromEntityId: args.fromEntityId,
        toEntityId: args.toEntityId,
        fromType: args.fromType,
        toType: args.toType,
        relationType: args.relationType,
        confidence: new Prisma.Decimal('1.000'),
        explanation: args.explanation,
        createdBy: 'manual',
        status: 'active',
        validFrom: now,
        properties: {},
      },
    });
  }

  private handleUniqueViolation(err: unknown, name: string | undefined): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'role_name_taken',
          message: `Должность с именем «${name ?? ''}» уже существует`,
        },
      });
    }
  }

  private toListItem(
    r: {
      id: string;
      name: string;
      departmentId: string | null;
      tags: string[];
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    },
    departmentName: string | null,
    personsCount: number,
    jobDescriptionsCount: number,
    roleProfileStatus: 'forming' | 'ready' | 'stale' | 'error' | null,
  ): RoleListItemDto {
    return {
      id: r.id,
      name: r.name,
      departmentId: r.departmentId,
      departmentName,
      tags: r.tags,
      personsCount,
      jobDescriptionsCount,
      roleProfileStatus,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    };
  }
}
