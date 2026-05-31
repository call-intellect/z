import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Table, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateTableBody,
  TablesListQuery,
  UpdateTableBody,
} from '../dto/tables.dto';

/**
 * Smart Tables — CRUD верхнего уровня (Фаза 0).
 *
 *   - create / findById / list / update
 *   - archive (soft) / unarchive
 *   - hardDelete — только если уже archived
 *
 * Лимит `TABLE_MAX_TABLES_PER_ORG` читается из `TypedConfigService` (ENV
 * + AdminSetting fallback). Multi-tenant scope — `tenantId` в каждом where.
 */
@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── create ─────────────────────────────────────

  async create(args: {
    tenantId: string;
    userId: string;
    input: CreateTableBody;
  }): Promise<Table> {
    const limit = this.cfg.smartTables.maxTablesPerOrg;
    const current = await this.prisma.table.count({
      where: { tenantId: args.tenantId, deletedAt: null },
    });
    if (current >= limit) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'table_limit_exceeded',
          message: `Превышен технический лимит таблиц в организации (${limit}). Если нужно больше — напишите в поддержку.`,
        },
      });
    }

    if (args.input.parentDocumentId) {
      const doc = await this.prisma.document.findUnique({
        where: { id: args.input.parentDocumentId },
        select: { tenantId: true, deletedAt: true },
      });
      if (!doc || doc.deletedAt || doc.tenantId !== args.tenantId) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'parent_document_not_found',
            message: 'Родительский документ не найден',
          },
        });
      }
    }

    return this.prisma.table.create({
      data: {
        tenantId: args.tenantId,
        name: args.input.name,
        description: args.input.description ?? null,
        icon: args.input.icon ?? null,
        parentDocumentId: args.input.parentDocumentId ?? null,
        entitySync: args.input.entitySync
          ? (args.input.entitySync as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        createdBy: args.userId,
      },
    });
  }

  // ─────────────────────────── findById ───────────────────────────────────

  async findById(args: { tenantId: string; id: string }): Promise<Table> {
    const row = await this.prisma.table.findUnique({
      where: { id: args.id },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'table_not_found', message: 'Таблица не найдена' },
      });
    }
    if (row.tenantId !== args.tenantId) {
      // Возвращаем 404, чтобы не подсказывать атакующему о существовании id.
      throw new NotFoundException({
        ok: false,
        error: { code: 'table_not_found', message: 'Таблица не найдена' },
      });
    }
    return row;
  }

  // ─────────────────────────── list ───────────────────────────────────────

  async list(args: {
    tenantId: string;
    query: TablesListQuery;
  }): Promise<{ items: Table[]; total: number }> {
    const where: Prisma.TableWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
    };
    if (args.query.archived === 'active') {
      where.archivedAt = null;
    } else if (args.query.archived === 'archived') {
      where.archivedAt = { not: null };
    }

    const [items, total] = await Promise.all([
      this.prisma.table.findMany({
        where,
        orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
        take: args.query.limit,
        skip: args.query.offset,
      }),
      this.prisma.table.count({ where }),
    ]);
    return { items, total };
  }

  // ─────────────────────────── update ─────────────────────────────────────

  async update(args: {
    tenantId: string;
    id: string;
    input: UpdateTableBody;
  }): Promise<Table> {
    const existing = await this.findById({ tenantId: args.tenantId, id: args.id });

    if (
      args.input.parentDocumentId !== undefined &&
      args.input.parentDocumentId !== null
    ) {
      const doc = await this.prisma.document.findUnique({
        where: { id: args.input.parentDocumentId },
        select: { tenantId: true, deletedAt: true },
      });
      if (!doc || doc.deletedAt || doc.tenantId !== args.tenantId) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'parent_document_not_found',
            message: 'Родительский документ не найден',
          },
        });
      }
    }

    const data: Prisma.TableUpdateInput = {};
    if (args.input.name !== undefined) data.name = args.input.name;
    if (args.input.description !== undefined) data.description = args.input.description;
    if (args.input.icon !== undefined) data.icon = args.input.icon;
    if (args.input.parentDocumentId !== undefined) {
      data.parentDocumentId = args.input.parentDocumentId;
    }
    if (args.input.entitySync !== undefined) {
      data.entitySync =
        args.input.entitySync === null
          ? Prisma.JsonNull
          : (args.input.entitySync as unknown as Prisma.InputJsonValue);
    }

    return this.prisma.table.update({
      where: { id: existing.id },
      data,
    });
  }

  // ─────────────────────────── archive / unarchive ────────────────────────

  async archive(args: { tenantId: string; id: string }): Promise<Table> {
    const existing = await this.findById({ tenantId: args.tenantId, id: args.id });
    if (existing.archivedAt) return existing; // идемпотентно
    return this.prisma.table.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    });
  }

  async unarchive(args: { tenantId: string; id: string }): Promise<Table> {
    const existing = await this.findById({ tenantId: args.tenantId, id: args.id });
    if (!existing.archivedAt) return existing; // идемпотентно
    return this.prisma.table.update({
      where: { id: existing.id },
      data: { archivedAt: null },
    });
  }

  // ─────────────────────────── hardDelete ─────────────────────────────────

  /**
   * Hard-delete можно только если таблица уже архивирована — это безопасный
   * двухшаговый сценарий «архив → удалить». Каскады по `onDelete: Cascade`
   * сами вычищают TableProperty / TableRow / TableView / TableAutomation.
   */
  async hardDelete(args: {
    tenantId: string;
    id: string;
  }): Promise<{ id: string }> {
    const existing = await this.findById({ tenantId: args.tenantId, id: args.id });
    if (!existing.archivedAt) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'table_must_be_archived',
          message:
            'Удалить можно только архивированную таблицу. Сначала переведите её в архив.',
        },
      });
    }
    await this.prisma.table.delete({ where: { id: existing.id } });
    this.logger.log(
      { tableId: existing.id, tenantId: args.tenantId },
      'tables.hardDelete: каскадно удалена',
    );
    return { id: existing.id };
  }
}
