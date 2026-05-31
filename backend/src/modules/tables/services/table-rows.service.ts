import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type TableRow, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateRowBody,
  RowsListQuery,
  UpdateRowBody,
} from '../dto/tables.dto';

/**
 * Smart Tables — CRUD строк (`TableRow`). Фаза 0.
 *
 *   - list / findById / create / update
 *   - archive (soft) / unarchive
 *   - hardDelete — только если уже archived
 *
 * Лимиты:
 *   - `TABLE_MAX_ROWS_PER_TABLE` — общая ёмкость таблицы.
 *   - `TABLE_MAX_CELL_SIZE_BYTES` — размер одного value в `cells`.
 *     При превышении возвращаем 400 с конкретным propertyId.
 *
 * Multi-tenant scope: `tenantId` родительской `Table` проверяется на каждой
 * операции (`requireTable` / `requireRow`).
 */
@Injectable()
export class TableRowsService {
  private readonly logger = new Logger(TableRowsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── list ───────────────────────────────────────

  async list(args: {
    tenantId: string;
    tableId: string;
    query: RowsListQuery;
  }): Promise<{ items: TableRow[]; total: number }> {
    await this.requireTable(args.tenantId, args.tableId);

    const where: Prisma.TableRowWhereInput = {
      tableId: args.tableId,
      tenantId: args.tenantId,
      deletedAt: null,
    };
    if (args.query.archived === 'active') {
      where.archivedAt = null;
    } else if (args.query.archived === 'archived') {
      where.archivedAt = { not: null };
    }

    const [items, total] = await Promise.all([
      this.prisma.tableRow.findMany({
        where,
        orderBy: { order: 'asc' },
        take: args.query.limit,
        skip: args.query.offset,
      }),
      this.prisma.tableRow.count({ where }),
    ]);
    return { items, total };
  }

  // ─────────────────────────── findById ───────────────────────────────────

  async findById(args: { tenantId: string; rowId: string }): Promise<TableRow> {
    return this.requireRow(args.tenantId, args.rowId);
  }

  // ─────────────────────────── create ─────────────────────────────────────

  async create(args: {
    tenantId: string;
    tableId: string;
    userId: string;
    input: CreateRowBody;
  }): Promise<TableRow> {
    await this.requireTable(args.tenantId, args.tableId);

    const limit = this.cfg.smartTables.maxRowsPerTable;
    const current = await this.prisma.tableRow.count({
      where: { tableId: args.tableId, deletedAt: null },
    });
    if (current >= limit) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'table_rows_limit_exceeded',
          message: `Превышен технический лимит строк в таблице (${limit}). Если нужно больше — напишите в поддержку.`,
        },
      });
    }

    this.assertCellsSize(args.input.cells ?? {});

    const order =
      args.input.order !== undefined
        ? args.input.order
        : await this.nextOrder(args.tableId);

    return this.prisma.tableRow.create({
      data: {
        tableId: args.tableId,
        tenantId: args.tenantId,
        cells: (args.input.cells ?? {}) as Prisma.InputJsonValue,
        entityId: args.input.entityId ?? null,
        order: new Prisma.Decimal(order),
        createdBy: args.userId,
        pageContent:
          args.input.pageContent === undefined
            ? Prisma.JsonNull
            : (args.input.pageContent as Prisma.InputJsonValue),
      },
    });
  }

  // ─────────────────────────── update ─────────────────────────────────────

  async update(args: {
    tenantId: string;
    rowId: string;
    input: UpdateRowBody;
  }): Promise<TableRow> {
    const existing = await this.requireRow(args.tenantId, args.rowId);

    const data: Prisma.TableRowUpdateInput = {};
    if (args.input.cells !== undefined) {
      this.assertCellsSize(args.input.cells);
      data.cells = args.input.cells as Prisma.InputJsonValue;
    }
    if (args.input.entityId !== undefined) data.entityId = args.input.entityId;
    if (args.input.order !== undefined) {
      data.order = new Prisma.Decimal(args.input.order);
    }
    if (args.input.pageContent !== undefined) {
      data.pageContent =
        args.input.pageContent === null
          ? Prisma.JsonNull
          : (args.input.pageContent as Prisma.InputJsonValue);
    }

    return this.prisma.tableRow.update({
      where: { id: existing.id },
      data,
    });
  }

  // ─────────────────────────── archive / unarchive ────────────────────────

  async archive(args: { tenantId: string; rowId: string }): Promise<TableRow> {
    const existing = await this.requireRow(args.tenantId, args.rowId);
    if (existing.archivedAt) return existing;
    return this.prisma.tableRow.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    });
  }

  async unarchive(args: { tenantId: string; rowId: string }): Promise<TableRow> {
    const existing = await this.requireRow(args.tenantId, args.rowId);
    if (!existing.archivedAt) return existing;
    return this.prisma.tableRow.update({
      where: { id: existing.id },
      data: { archivedAt: null },
    });
  }

  // ─────────────────────────── hardDelete ─────────────────────────────────

  async hardDelete(args: {
    tenantId: string;
    rowId: string;
  }): Promise<{ id: string }> {
    const existing = await this.requireRow(args.tenantId, args.rowId);
    if (!existing.archivedAt) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'row_must_be_archived',
          message:
            'Удалить можно только архивированную строку. Сначала переведите её в архив.',
        },
      });
    }
    await this.prisma.tableRow.delete({ where: { id: existing.id } });
    this.logger.log(
      { rowId: existing.id, tableId: existing.tableId },
      'tables.rows: hard-delete',
    );
    return { id: existing.id };
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private async requireTable(tenantId: string, tableId: string): Promise<void> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!table || table.deletedAt || table.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'table_not_found', message: 'Таблица не найдена' },
      });
    }
  }

  private async requireRow(tenantId: string, rowId: string): Promise<TableRow> {
    const row = await this.prisma.tableRow.findUnique({
      where: { id: rowId },
    });
    if (!row || row.deletedAt || row.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'row_not_found', message: 'Строка не найдена' },
      });
    }
    return row;
  }

  private async nextOrder(tableId: string): Promise<number> {
    const last = await this.prisma.tableRow.findFirst({
      where: { tableId, deletedAt: null },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    if (!last) return 1;
    return Number(last.order.toString()) + 1;
  }

  /**
   * Проверяет размер каждого value в `cells`. JSON-сериализация каждого
   * значения по отдельности — чтобы в сообщении вернуть конкретный
   * propertyId, превысивший лимит.
   */
  private assertCellsSize(cells: Record<string, unknown>): void {
    const cap = this.cfg.smartTables.maxCellSizeBytes;
    for (const [propertyId, value] of Object.entries(cells)) {
      if (value === undefined || value === null) continue;
      const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
      if (size > cap) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'cell_too_large',
            message: `Значение ячейки "${propertyId}" превышает лимит ${cap} байт (фактически ${size}).`,
          },
        });
      }
    }
  }
}
