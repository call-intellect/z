import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  AuthorityBoundaryDto,
  AuthorityKind,
  CreateAuthorityBoundaryDto,
  UpdateAuthorityBoundaryDto,
} from '../dto/role-map.dto';

import { mergeSourceBlocks } from './responsibility-element.service';

@Injectable()
export class AuthorityBoundaryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listByRole(args: {
    tenantId: string;
    roleId: string;
    kind?: AuthorityKind;
  }): Promise<AuthorityBoundaryDto[]> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    const rows = await this.prisma.authorityBoundary.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        deletedAt: null,
        ...(args.kind ? { kind: args.kind } : {}),
      },
      include: {
        approverRole: { select: { id: true, name: true } },
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(args: { tenantId: string; id: string }): Promise<AuthorityBoundaryDto> {
    const row = await this.prisma.authorityBoundary.findUnique({
      where: { id: args.id },
      include: { approverRole: { select: { id: true, name: true } } },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'authority_not_found',
          message: 'Граница полномочий не найдена',
        },
      });
    }
    return this.toDto(row);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    roleId: string;
    body: CreateAuthorityBoundaryDto;
  }): Promise<AuthorityBoundaryDto> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    if (args.body.approverRoleId) {
      await this.assertRoleExists(args.tenantId, args.body.approverRoleId);
    }
    const created = await this.prisma.authorityBoundary.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.body.kind,
        scope: args.body.scope,
        approverRoleId: args.body.approverRoleId ?? null,
        thresholdsJson:
          args.body.thresholdsJson === undefined || args.body.thresholdsJson === null
            ? Prisma.JsonNull
            : (args.body.thresholdsJson as Prisma.InputJsonValue),
        sourceBlockIds: args.body.sourceBlockIds ?? [],
        confidence:
          args.body.confidence !== undefined ? new Prisma.Decimal(args.body.confidence) : null,
      },
      include: { approverRole: { select: { id: true, name: true } } },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.authority.created',
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
    body: UpdateAuthorityBoundaryDto;
  }): Promise<AuthorityBoundaryDto> {
    const existing = await this.prisma.authorityBoundary.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'authority_not_found',
          message: 'Граница полномочий не найдена',
        },
      });
    }
    if (args.body.approverRoleId) {
      await this.assertRoleExists(args.tenantId, args.body.approverRoleId);
    }
    const data: Prisma.AuthorityBoundaryUpdateInput = {};
    if (args.body.kind !== undefined) data.kind = args.body.kind;
    if (args.body.scope !== undefined) data.scope = args.body.scope;
    if (args.body.approverRoleId !== undefined) {
      data.approverRole =
        args.body.approverRoleId === null
          ? { disconnect: true }
          : { connect: { id: args.body.approverRoleId } };
    }
    if (args.body.thresholdsJson !== undefined) {
      data.thresholdsJson =
        args.body.thresholdsJson === null
          ? Prisma.JsonNull
          : (args.body.thresholdsJson as Prisma.InputJsonValue);
    }
    if (args.body.confidence !== undefined) {
      data.confidence = new Prisma.Decimal(args.body.confidence);
    }
    if (args.body.sourceBlockIds !== undefined) {
      data.sourceBlockIds = args.body.sourceBlockIds;
    }
    const updated = await this.prisma.authorityBoundary.update({
      where: { id: args.id },
      data,
      include: { approverRole: { select: { id: true, name: true } } },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.authority.updated',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        roleId: existing.roleId,
        changedFields: Object.keys(args.body),
      },
    });
    return this.toDto(updated);
  }

  async softDelete(args: { tenantId: string; userId: string; id: string }): Promise<{ ok: true }> {
    const existing = await this.prisma.authorityBoundary.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'authority_not_found',
          message: 'Граница полномочий не найдена',
        },
      });
    }
    await this.prisma.authorityBoundary.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.authority.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, roleId: existing.roleId },
    });
    return { ok: true };
  }

  async upsertByScope(args: {
    tenantId: string;
    roleId: string;
    kind: AuthorityKind;
    scope: string;
    approverRoleId?: string | null;
    thresholdsJson?: Record<string, unknown> | null;
    sourceBlockIds?: string[];
    confidence?: number | null;
  }): Promise<AuthorityBoundaryDto> {
    const existing = await this.prisma.authorityBoundary.findFirst({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.kind,
        scope: args.scope,
        deletedAt: null,
      },
      include: { approverRole: { select: { id: true, name: true } } },
    });
    if (existing) {
      const updated = await this.prisma.authorityBoundary.update({
        where: { id: existing.id },
        data: {
          approverRoleId:
            args.approverRoleId !== undefined ? args.approverRoleId : existing.approverRoleId,
          thresholdsJson:
            args.thresholdsJson !== undefined
              ? args.thresholdsJson === null
                ? Prisma.JsonNull
                : (args.thresholdsJson as Prisma.InputJsonValue)
              : (existing.thresholdsJson as Prisma.InputJsonValue),
          sourceBlockIds: mergeSourceBlocks(existing.sourceBlockIds, args.sourceBlockIds),
          confidence:
            args.confidence !== undefined && args.confidence !== null
              ? new Prisma.Decimal(args.confidence)
              : existing.confidence,
        },
        include: { approverRole: { select: { id: true, name: true } } },
      });
      return this.toDto(updated);
    }
    const created = await this.prisma.authorityBoundary.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.kind,
        scope: args.scope,
        approverRoleId: args.approverRoleId ?? null,
        thresholdsJson:
          args.thresholdsJson === undefined || args.thresholdsJson === null
            ? Prisma.JsonNull
            : (args.thresholdsJson as Prisma.InputJsonValue),
        sourceBlockIds: args.sourceBlockIds ?? [],
        confidence:
          args.confidence !== undefined && args.confidence !== null
            ? new Prisma.Decimal(args.confidence)
            : null,
      },
      include: { approverRole: { select: { id: true, name: true } } },
    });
    return this.toDto(created);
  }

  private async assertRoleExists(tenantId: string, roleId: string): Promise<void> {
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

  private toDto(row: {
    id: string;
    tenantId: string;
    roleId: string;
    kind: string;
    scope: string;
    approverRoleId: string | null;
    thresholdsJson: Prisma.JsonValue | null;
    sourceBlockIds: string[];
    confidence: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
    approverRole?: { id: string; name: string } | null;
  }): AuthorityBoundaryDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      kind: row.kind as AuthorityKind,
      scope: row.scope,
      approverRoleId: row.approverRoleId,
      approverRoleName: row.approverRole?.name ?? null,
      thresholdsJson:
        row.thresholdsJson &&
        typeof row.thresholdsJson === 'object' &&
        !Array.isArray(row.thresholdsJson)
          ? (row.thresholdsJson as Record<string, unknown>)
          : null,
      sourceBlockIds: row.sourceBlockIds,
      confidence: row.confidence === null ? null : Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
