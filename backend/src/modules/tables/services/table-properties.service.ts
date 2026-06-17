import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type TableProperty, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreatePropertyBody, UpdatePropertyBody } from '../dto/tables.dto';

@Injectable()
export class TablePropertiesService {
  private readonly logger = new Logger(TablePropertiesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async list(args: { tenantId: string; tableId: string }): Promise<TableProperty[]> {
    await this.requireTable(args.tenantId, args.tableId);
    return this.prisma.tableProperty.findMany({
      where: { tableId: args.tableId },
      orderBy: { order: 'asc' },
    });
  }

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
      args.input.order !== undefined ? args.input.order : await this.nextOrder(args.tableId);

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

  async createMany(args: {
    tenantId: string;
    tableId: string;
    properties: Array<{
      name: string;
      type: CreatePropertyBody['type'];
      isPrimary?: boolean;
      config?: Record<string, unknown>;
    }>;
  }): Promise<number> {
    await this.requireTable(args.tenantId, args.tableId);
    if (args.properties.length === 0) return 0;

    const data = args.properties.map((p, i) => ({
      tableId: args.tableId,
      name: p.name,
      type: p.type,
      config: (p.config ?? {}) as Prisma.InputJsonValue,
      isPrimary: p.isPrimary ?? false,
      order: new Prisma.Decimal((i + 1) * 1000),
    }));

    const res = await this.prisma.tableProperty.createMany({ data });
    this.logger.log(
      { tableId: args.tableId, count: res.count },
      'tables.properties: bulk-create from schema',
    );
    return res.count;
  }

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

  async delete(args: { tenantId: string; propertyId: string }): Promise<{ id: string }> {
    const existing = await this.requireProperty(args.tenantId, args.propertyId);
    await this.prisma.tableProperty.delete({ where: { id: existing.id } });
    this.logger.log(
      { propertyId: existing.id, tableId: existing.tableId },
      'tables.properties: hard-delete',
    );
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

  private async requireProperty(tenantId: string, propertyId: string): Promise<TableProperty> {
    const property = await this.prisma.tableProperty.findUnique({
      where: { id: propertyId },
      include: { table: { select: { tenantId: true, deletedAt: true } } },
    });
    if (!property || property.table.deletedAt || property.table.tenantId !== tenantId) {
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
