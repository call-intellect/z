import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateInteractionDto,
  InteractionDto,
  InteractionFrequency,
  InteractionKind,
  UpdateInteractionDto,
} from '../dto/role-map.dto';

import { mergeSourceBlocks } from './responsibility-element.service';

/**
 * SBA α-8 wave 4 — CRUD-сервис Interaction.
 *
 * Типовые взаимодействия роли (reports_to / collaborates_with / delegates_to /
 * receives_handoff_from / escalates_to / customer_facing / ...). Используется
 * γ-3 CrossFunctional для карты handoff'ов и β-8 для PersonalRelation patterns.
 */
@Injectable()
export class InteractionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listByRole(args: {
    tenantId: string;
    roleId: string;
    kind?: InteractionKind | string;
  }): Promise<InteractionDto[]> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    const rows = await this.prisma.interaction.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        deletedAt: null,
        ...(args.kind ? { kind: args.kind } : {}),
      },
      include: {
        counterpartRole: { select: { id: true, name: true } },
        counterpartDepartment: { select: { id: true, name: true } },
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(args: { tenantId: string; id: string }): Promise<InteractionDto> {
    const row = await this.prisma.interaction.findUnique({
      where: { id: args.id },
      include: {
        counterpartRole: { select: { id: true, name: true } },
        counterpartDepartment: { select: { id: true, name: true } },
      },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'interaction_not_found',
          message: 'Взаимодействие не найдено',
        },
      });
    }
    return this.toDto(row);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    roleId: string;
    body: CreateInteractionDto;
  }): Promise<InteractionDto> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    if (args.body.counterpartRoleId) {
      await this.assertRoleExists(args.tenantId, args.body.counterpartRoleId);
    }
    if (args.body.counterpartDepartmentId) {
      await this.assertDepartmentExists(
        args.tenantId,
        args.body.counterpartDepartmentId,
      );
    }
    const created = await this.prisma.interaction.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.body.kind,
        counterpartRoleId: args.body.counterpartRoleId ?? null,
        counterpartDepartmentId: args.body.counterpartDepartmentId ?? null,
        counterpartExternal: args.body.counterpartExternal ?? null,
        frequency: args.body.frequency ?? null,
        description: args.body.description ?? null,
        sourceBlockIds: args.body.sourceBlockIds ?? [],
        confidence:
          args.body.confidence !== undefined
            ? new Prisma.Decimal(args.body.confidence)
            : null,
      },
      include: {
        counterpartRole: { select: { id: true, name: true } },
        counterpartDepartment: { select: { id: true, name: true } },
      },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.interaction.created',
      resourceId: created.id,
      metadata: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.body.kind,
      },
    });
    return this.toDto(created);
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateInteractionDto;
  }): Promise<InteractionDto> {
    const existing = await this.prisma.interaction.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'interaction_not_found',
          message: 'Взаимодействие не найдено',
        },
      });
    }
    if (args.body.counterpartRoleId) {
      await this.assertRoleExists(args.tenantId, args.body.counterpartRoleId);
    }
    if (args.body.counterpartDepartmentId) {
      await this.assertDepartmentExists(
        args.tenantId,
        args.body.counterpartDepartmentId,
      );
    }
    const data: Prisma.InteractionUpdateInput = {};
    if (args.body.kind !== undefined) data.kind = args.body.kind;
    if (args.body.counterpartRoleId !== undefined) {
      data.counterpartRole =
        args.body.counterpartRoleId === null
          ? { disconnect: true }
          : { connect: { id: args.body.counterpartRoleId } };
    }
    if (args.body.counterpartDepartmentId !== undefined) {
      data.counterpartDepartment =
        args.body.counterpartDepartmentId === null
          ? { disconnect: true }
          : { connect: { id: args.body.counterpartDepartmentId } };
    }
    if (args.body.counterpartExternal !== undefined) {
      data.counterpartExternal = args.body.counterpartExternal;
    }
    if (args.body.frequency !== undefined) data.frequency = args.body.frequency;
    if (args.body.description !== undefined) {
      data.description = args.body.description;
    }
    if (args.body.confidence !== undefined) {
      data.confidence = new Prisma.Decimal(args.body.confidence);
    }
    if (args.body.sourceBlockIds !== undefined) {
      data.sourceBlockIds = args.body.sourceBlockIds;
    }
    const updated = await this.prisma.interaction.update({
      where: { id: args.id },
      data,
      include: {
        counterpartRole: { select: { id: true, name: true } },
        counterpartDepartment: { select: { id: true, name: true } },
      },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.interaction.updated',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        roleId: existing.roleId,
        changedFields: Object.keys(args.body),
      },
    });
    return this.toDto(updated);
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.interaction.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'interaction_not_found',
          message: 'Взаимодействие не найдено',
        },
      });
    }
    await this.prisma.interaction.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.interaction.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, roleId: existing.roleId },
    });
    return { ok: true };
  }

  /**
   * Upsert по «(kind, counterpartKey)» — для auto-extract'а из LLM.
   * counterpartKey = counterpartRoleId || `dept:${departmentId}` || `ext:${external}`.
   */
  async upsertByCounterpart(args: {
    tenantId: string;
    roleId: string;
    kind: InteractionKind | string;
    counterpartRoleId?: string | null;
    counterpartDepartmentId?: string | null;
    counterpartExternal?: string | null;
    frequency?: InteractionFrequency | string | null;
    description?: string | null;
    sourceBlockIds?: string[];
    confidence?: number | null;
  }): Promise<InteractionDto> {
    if (
      !args.counterpartRoleId &&
      !args.counterpartDepartmentId &&
      !args.counterpartExternal
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'counterpart_required',
          message: 'Должен быть указан counterpart',
        },
      });
    }
    const existing = await this.prisma.interaction.findFirst({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.kind,
        counterpartRoleId: args.counterpartRoleId ?? null,
        counterpartDepartmentId: args.counterpartDepartmentId ?? null,
        counterpartExternal: args.counterpartExternal ?? null,
        deletedAt: null,
      },
      include: {
        counterpartRole: { select: { id: true, name: true } },
        counterpartDepartment: { select: { id: true, name: true } },
      },
    });
    if (existing) {
      const updated = await this.prisma.interaction.update({
        where: { id: existing.id },
        data: {
          frequency:
            args.frequency !== undefined ? args.frequency : existing.frequency,
          description:
            args.description !== undefined
              ? args.description
              : existing.description,
          sourceBlockIds: mergeSourceBlocks(
            existing.sourceBlockIds,
            args.sourceBlockIds,
          ),
          confidence:
            args.confidence !== undefined && args.confidence !== null
              ? new Prisma.Decimal(args.confidence)
              : existing.confidence,
        },
        include: {
          counterpartRole: { select: { id: true, name: true } },
          counterpartDepartment: { select: { id: true, name: true } },
        },
      });
      return this.toDto(updated);
    }
    const created = await this.prisma.interaction.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.kind,
        counterpartRoleId: args.counterpartRoleId ?? null,
        counterpartDepartmentId: args.counterpartDepartmentId ?? null,
        counterpartExternal: args.counterpartExternal ?? null,
        frequency: args.frequency ?? null,
        description: args.description ?? null,
        sourceBlockIds: args.sourceBlockIds ?? [],
        confidence:
          args.confidence !== undefined && args.confidence !== null
            ? new Prisma.Decimal(args.confidence)
            : null,
      },
      include: {
        counterpartRole: { select: { id: true, name: true } },
        counterpartDepartment: { select: { id: true, name: true } },
      },
    });
    return this.toDto(created);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private async assertRoleExists(
    tenantId: string,
    roleId: string,
  ): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!role || role.tenantId !== tenantId || role.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'role_not_found',
          message: 'Должность не найдена или удалена',
        },
      });
    }
  }

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
          message: 'Отдел не найден или удалён',
        },
      });
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    roleId: string;
    kind: string;
    counterpartRoleId: string | null;
    counterpartDepartmentId: string | null;
    counterpartExternal: string | null;
    frequency: string | null;
    description: string | null;
    sourceBlockIds: string[];
    confidence: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
    counterpartRole?: { id: string; name: string } | null;
    counterpartDepartment?: { id: string; name: string } | null;
  }): InteractionDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      kind: row.kind,
      counterpartRoleId: row.counterpartRoleId,
      counterpartRoleName: row.counterpartRole?.name ?? null,
      counterpartDepartmentId: row.counterpartDepartmentId,
      counterpartDepartmentName: row.counterpartDepartment?.name ?? null,
      counterpartExternal: row.counterpartExternal,
      frequency: row.frequency,
      description: row.description,
      sourceBlockIds: row.sourceBlockIds,
      confidence: row.confidence === null ? null : Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
