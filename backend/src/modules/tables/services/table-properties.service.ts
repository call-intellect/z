import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type TableProperty, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreatePropertyBody,
  UpdatePropertyBody,
} from '../dto/tables.dto';

/**
 * Smart Tables — CRUD колонок (`TableProperty`). Фаза 0.
 *
 * Лимит колонок на таблицу: `TABLE_MAX_PROPS_PER_TABLE`. Порядок — фракционная
 * сортировка (Decimal(20,10)); если `order` не задан — ставим `maxOrder + 1`.
 *
 * Multi-tenant scope: все операции проходят через проверку, что родительская
 * `Table` принадлежит `tenantId` вызывающего пользователя.
 */
@Injectable()
export class TablePropertiesService {
  private readonly logger = new Logger(TablePropertiesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── list ───────────────────────────────────────

  async list(args: { tenantId: string; tableId: string }): Promise<TableProperty[]> {
    await this.requireTable(args.tenantId, args.tableId);
    return this.prisma.tableProperty.findMany({
      where: { tableId: args.tableId },
      orderBy: { order: 'asc' },
    });
  }

  // ─────────────────────────── create ─────────────────────────────────────

  async create(args: {
    tenantId: string;
    tableId: string;
    input: CreatePropertyBody;
  }): Promise<TableProperty> {
    await this.requireTable(args.tenantId, args.tableId);

    const limit = this.cfg.smartTables.maxPropsPerTable;
    const current = await this.prisma.tableProperty.count({
      where: { tableId: args.tableId },
    });
    if (current >= limit) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'table_props_limit_exceeded',
          message: `Превышен технический лимит колонок в таблице (${limit}). Если нужно больше — напишите в поддержку.`,
        },
      });
    }

    const order =
      args.input.order !== undefined
        ? args.input.order
        : await this.nextOrder(args.tableId);

    return this.prisma.tableProperty.create({
      data: {
        tableId: args.tableId,
        name: args.input.name,
        type: args.input.type,
        config: (args.input.config ?? {}) as Prisma.InputJsonValue,
        isPrimary: args.input.isPrimary ?? false,
        order: new Prisma.Decimal(order),
      },
    });
  }

  // ─────────────────────────── update ─────────────────────────────────────

  async update(args: {
    tenantId: string;
    propertyId: string;
    input: UpdatePropertyBody;
  }): Promise<TableProperty> {
    const existing = await this.requireProperty(args.tenantId, args.propertyId);

    const data: Prisma.TablePropertyUpdateInput = {};
    if (args.input.name !== undefined) data.name = args.input.name;
    if (args.input.config !== undefined) {
      data.config = args.input.config as Prisma.InputJsonValue;
    }
    if (args.input.isPrimary !== undefined) data.isPrimary = args.input.isPrimary;

    return this.prisma.tableProperty.update({
      where: { id: existing.id },
      data,
    });
  }

  // ─────────────────────────── reorder ────────────────────────────────────

  async reorder(args: {
    tenantId: string;
    propertyId: string;
    order: number;
  }): Promise<TableProperty> {
    const existing = await this.requireProperty(args.tenantId, args.propertyId);
    return this.prisma.tableProperty.update({
      where: { id: existing.id },
      data: { order: new Prisma.Decimal(args.order) },
    });
  }

  // ─────────────────────────── delete ─────────────────────────────────────

  /**
   * Hard-delete колонки. Значения в `TableRow.cells` (JSON) при этом остаются
   * как «orphan» по ключу-id колонки — безопасно (UI просто их не отрисует).
   * Чистить cells массово не нужно: это дорого и может удалить данные, нужные
   * для отката.
   */
  async delete(args: { tenantId: string; propertyId: string }): Promise<{ id: string }> {
    const existing = await this.requireProperty(args.tenantId, args.propertyId);
    await this.prisma.tableProperty.delete({ where: { id: existing.id } });
    this.logger.log(
      { propertyId: existing.id, tableId: existing.tableId },
      'tables.properties: hard-delete',
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

  private async requireProperty(
    tenantId: string,
    propertyId: string,
  ): Promise<TableProperty> {
    const property = await this.prisma.tableProperty.findUnique({
      where: { id: propertyId },
      include: { table: { select: { tenantId: true, deletedAt: true } } },
    });
    if (
      !property ||
      property.table.deletedAt ||
      property.table.tenantId !== tenantId
    ) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'property_not_found', message: 'Колонка не найдена' },
      });
    }
    return property;
  }

  private async nextOrder(tableId: string): Promise<number> {
    const last = await this.prisma.tableProperty.findFirst({
      where: { tableId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    if (!last) return 1;
    return Number(last.order.toString()) + 1;
  }
}
