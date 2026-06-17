import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type TableRow, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateRowBody, RowsListQuery, UpdateRowBody } from '../dto/tables.dto';

@Injectable()
export class TableRowsService {
  private readonly logger = new Logger(TableRowsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

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

  async findById(args: { tenantId: string; rowId: string }): Promise<TableRow> {
    return this.requireRow(args.tenantId, args.rowId);
  }

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
      args.input.order !== undefined ? args.input.order : await this.nextOrder(args.tableId);

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

  async createMany(args: {
    tenantId: string;
    tableId: string;
    userId?: string;
    rows: Array<{ cells: Record<string, unknown>; entityId?: string | null }>;
  }): Promise<{ created: number }> {
    await this.requireTable(args.tenantId, args.tableId);
    if (args.rows.length === 0) return { created: 0 };

    let order = await this.nextOrder(args.tableId);
    const data = args.rows.map((r) => {
      this.assertCellsSize(r.cells ?? {});
      return {
        tableId: args.tableId,
        tenantId: args.tenantId,
        cells: (r.cells ?? {}) as Prisma.InputJsonValue,
        entityId: r.entityId ?? null,
        order: new Prisma.Decimal(order++),
        createdBy: args.userId ?? 'system',
      };
    });
    const res = await this.prisma.tableRow.createMany({ data });
    return { created: res.count };
  }

  async update(args: { tenantId: string; rowId: string; input: UpdateRowBody }): Promise<TableRow> {
    const existing = await this.requireRow(args.tenantId, args.rowId);

    if (args.input.cells !== undefined) {
      await this.assertNoReadonlyCells(existing.tableId, args.input.cells);
    }

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

  async hardDelete(args: { tenantId: string; rowId: string }): Promise<{ id: string }> {
    const existing = await this.requireRow(args.tenantId, args.rowId);
    if (!existing.archivedAt) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'row_must_be_archived',
          message: 'Удалить можно только архивированную строку. Сначала переведите её в архив.',
        },
      });
    }
    await this.prisma.tableRow.delete({ where: { id: existing.id } });
    this.logger.log({ rowId: existing.id, tableId: existing.tableId }, 'tables.rows: hard-delete');
    return { id: existing.id };
  }

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

  private async assertNoReadonlyCells(
    tableId: string,
    cells: Record<string, unknown>,
  ): Promise<void> {
    const keys = Object.keys(cells);
    if (keys.length === 0) return;

    const props = await this.prisma.tableProperty.findMany({
      where: { tableId, id: { in: keys } },
      select: { id: true, name: true, config: true },
    });
    for (const p of props) {
      const cfg = (p.config as Record<string, unknown> | null) ?? {};
      const isReadonly = cfg['readonly'] === true || cfg['source'] === 'entity';
      if (isReadonly) {
        throw new UnprocessableEntityException({
          ok: false,
          error: {
            code: 'table_cell_readonly',
            message: `Колонка «${p.name}» заполняется автоматически из памяти компании — её нельзя изменить в таблице. Отредактируйте саму сущность.`,
          },
        });
      }
    }
  }

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
