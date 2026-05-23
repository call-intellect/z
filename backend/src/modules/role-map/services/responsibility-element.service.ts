import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateResponsibilityElementDto,
  ResponsibilityElementDto,
  ResponsibilityKind,
  UpdateResponsibilityElementDto,
} from '../dto/role-map.dto';

/**
 * SBA α-8 wave 4 — CRUD-сервис ResponsibilityElement (нормализованная
 * сущность wave 2, см. plans/tz/2026-05-23-sba-alpha-8-wave2-models.md).
 *
 * Тонкий CRUD-wrapper: бизнес-логика сборки Role Map — в
 * RoleMapBuilderService. Здесь только:
 *   - валидация принадлежности (tenantId + roleId);
 *   - параметризованные иерархические выборки (parent/children);
 *   - аудит изменений.
 */
@Injectable()
export class ResponsibilityElementService {
  private readonly logger = new Logger(ResponsibilityElementService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listByRole(args: {
    tenantId: string;
    roleId: string;
    kind?: ResponsibilityKind;
  }): Promise<ResponsibilityElementDto[]> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    const rows = await this.prisma.responsibilityElement.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        deletedAt: null,
        ...(args.kind ? { kind: args.kind } : {}),
      },
      orderBy: [{ kind: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(args: {
    tenantId: string;
    id: string;
  }): Promise<ResponsibilityElementDto> {
    const row = await this.prisma.responsibilityElement.findUnique({
      where: { id: args.id },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'responsibility_not_found',
          message: 'Элемент ответственности не найден',
        },
      });
    }
    return this.toDto(row);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    roleId: string;
    body: CreateResponsibilityElementDto;
  }): Promise<ResponsibilityElementDto> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    if (args.body.parentId) {
      await this.assertParentBelongsToRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
        parentId: args.body.parentId,
      });
    }

    const created = await this.prisma.responsibilityElement.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        parentId: args.body.parentId ?? null,
        kind: args.body.kind,
        name: args.body.name,
        description: args.body.description ?? null,
        order: args.body.order ?? 0,
        sourceBlockIds: args.body.sourceBlockIds ?? [],
        confidence:
          args.body.confidence !== undefined
            ? new Prisma.Decimal(args.body.confidence)
            : null,
      },
    });

    void this.audit.log({
      userId: args.userId,
      action: 'role_map.responsibility.created',
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
    body: UpdateResponsibilityElementDto;
  }): Promise<ResponsibilityElementDto> {
    const existing = await this.prisma.responsibilityElement.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'responsibility_not_found',
          message: 'Элемент ответственности не найден',
        },
      });
    }
    if (args.body.parentId !== undefined && args.body.parentId !== null) {
      await this.assertParentBelongsToRole({
        tenantId: args.tenantId,
        roleId: existing.roleId,
        parentId: args.body.parentId,
      });
    }
    const data: Prisma.ResponsibilityElementUpdateInput = {};
    if (args.body.parentId !== undefined) {
      data.parent =
        args.body.parentId === null
          ? { disconnect: true }
          : { connect: { id: args.body.parentId } };
    }
    if (args.body.kind !== undefined) data.kind = args.body.kind;
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.description !== undefined) {
      data.description = args.body.description;
    }
    if (args.body.order !== undefined) data.order = args.body.order;
    if (args.body.confidence !== undefined) {
      data.confidence = new Prisma.Decimal(args.body.confidence);
    }
    if (args.body.sourceBlockIds !== undefined) {
      data.sourceBlockIds = args.body.sourceBlockIds;
    }
    const updated = await this.prisma.responsibilityElement.update({
      where: { id: args.id },
      data,
    });

    void this.audit.log({
      userId: args.userId,
      action: 'role_map.responsibility.updated',
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
    const existing = await this.prisma.responsibilityElement.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'responsibility_not_found',
          message: 'Элемент ответственности не найден',
        },
      });
    }
    await this.prisma.responsibilityElement.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.responsibility.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, roleId: existing.roleId },
    });
    return { ok: true };
  }

  /**
   * Upsert «по имени» — используется RoleMapBuilderService при auto-extract
   * из LLM. Если элемент с таким (roleId, name, kind) уже есть — обновляем,
   * иначе создаём.
   */
  async upsertByName(args: {
    tenantId: string;
    roleId: string;
    kind: ResponsibilityKind;
    name: string;
    description?: string | null;
    sourceBlockIds?: string[];
    confidence?: number | null;
  }): Promise<ResponsibilityElementDto> {
    const existing = await this.prisma.responsibilityElement.findFirst({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.kind,
        name: args.name,
        deletedAt: null,
      },
    });
    if (existing) {
      const updated = await this.prisma.responsibilityElement.update({
        where: { id: existing.id },
        data: {
          description: args.description ?? existing.description,
          sourceBlockIds: mergeSourceBlocks(
            existing.sourceBlockIds,
            args.sourceBlockIds,
          ),
          confidence:
            args.confidence !== undefined && args.confidence !== null
              ? new Prisma.Decimal(args.confidence)
              : existing.confidence,
        },
      });
      return this.toDto(updated);
    }
    const created = await this.prisma.responsibilityElement.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        kind: args.kind,
        name: args.name,
        description: args.description ?? null,
        order: 0,
        sourceBlockIds: args.sourceBlockIds ?? [],
        confidence:
          args.confidence !== undefined && args.confidence !== null
            ? new Prisma.Decimal(args.confidence)
            : null,
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

  private async assertParentBelongsToRole(args: {
    tenantId: string;
    roleId: string;
    parentId: string;
  }): Promise<void> {
    const parent = await this.prisma.responsibilityElement.findUnique({
      where: { id: args.parentId },
      select: { tenantId: true, roleId: true, deletedAt: true },
    });
    if (
      !parent ||
      parent.tenantId !== args.tenantId ||
      parent.roleId !== args.roleId ||
      parent.deletedAt
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_invalid',
          message: 'Родительский элемент должен принадлежать той же роли',
        },
      });
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    roleId: string;
    parentId: string | null;
    kind: string;
    name: string;
    description: string | null;
    order: number;
    sourceBlockIds: string[];
    confidence: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
  }): ResponsibilityElementDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      parentId: row.parentId,
      kind: row.kind as ResponsibilityKind,
      name: row.name,
      description: row.description,
      order: row.order,
      sourceBlockIds: row.sourceBlockIds,
      confidence: row.confidence === null ? null : Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Объединение двух списков provenance-блоков без дублей, capped 50.
 * Используется upsert'ами всех 5 wave-2 сервисов.
 */
export function mergeSourceBlocks(
  current: string[],
  incoming?: string[] | null,
): string[] {
  if (!incoming || incoming.length === 0) return current;
  const set = new Set(current);
  for (const id of incoming) set.add(id);
  const merged = Array.from(set);
  return merged.length > 50 ? merged.slice(-50) : merged;
}
