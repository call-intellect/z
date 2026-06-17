import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type TableView, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';
import type { CreateTableViewBody, UpdateTableViewBody } from '../dto/tables.dto';

@Injectable()
export class TableViewsService {
  private readonly logger = new Logger(TableViewsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async list(args: { tenantId: string; tableId: string; userId: string }): Promise<TableView[]> {
    await this.requireTable(args.tenantId, args.tableId);
    return this.prisma.tableView.findMany({
      where: {
        tableId: args.tableId,
        OR: [
          { visibility: { in: ['shared', 'public'] } },
          { visibility: 'personal', ownerId: args.userId },
        ],
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findById(args: {
    tenantId: string;
    tableId: string;
    viewId: string;
    userId: string;
  }): Promise<TableView> {
    await this.requireTable(args.tenantId, args.tableId);
    const view = await this.prisma.tableView.findUnique({
      where: { id: args.viewId },
    });
    if (!view || view.tableId !== args.tableId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'view_not_found', message: 'Вид не найден' },
      });
    }
    if (view.visibility === 'personal' && view.ownerId !== args.userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'view_not_found', message: 'Вид не найден' },
      });
    }
    return view;
  }

  async create(args: {
    tenantId: string;
    tableId: string;
    userId: string;
    input: CreateTableViewBody;
  }): Promise<TableView> {
    await this.requireTable(args.tenantId, args.tableId);
    return this.prisma.tableView.create({
      data: {
        tableId: args.tableId,
        name: args.input.name,
        type: args.input.type,
        config: (args.input.config ?? {}) as Prisma.InputJsonValue,
        visibility: args.input.visibility,
        ownerId: args.userId,
      },
    });
  }

  async update(args: {
    tenantId: string;
    tableId: string;
    viewId: string;
    userId: string;
    input: UpdateTableViewBody;
  }): Promise<TableView> {
    const existing = await this.findById({
      tenantId: args.tenantId,
      tableId: args.tableId,
      viewId: args.viewId,
      userId: args.userId,
    });
    await this.requireOwnerOrAdmin(args.userId, args.tenantId, existing.ownerId);

    const data: Prisma.TableViewUpdateInput = {};
    if (args.input.name !== undefined) data.name = args.input.name;
    if (args.input.type !== undefined) data.type = args.input.type;
    if (args.input.visibility !== undefined) {
      data.visibility = args.input.visibility;
    }
    if (args.input.config !== undefined) {
      data.config = args.input.config as Prisma.InputJsonValue;
    }

    return this.prisma.tableView.update({
      where: { id: existing.id },
      data,
    });
  }

  async delete(args: {
    tenantId: string;
    tableId: string;
    viewId: string;
    userId: string;
  }): Promise<{ id: string }> {
    const existing = await this.findById({
      tenantId: args.tenantId,
      tableId: args.tableId,
      viewId: args.viewId,
      userId: args.userId,
    });
    await this.requireOwnerOrAdmin(args.userId, args.tenantId, existing.ownerId);
    await this.prisma.tableView.delete({ where: { id: existing.id } });
    this.logger.log(
      { viewId: existing.id, tableId: existing.tableId, userId: args.userId },
      'tables.views: hard-delete',
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

  private async requireOwnerOrAdmin(
    userId: string,
    tenantId: string,
    ownerId: string,
  ): Promise<void> {
    if (ownerId === userId) return;
    const ok = await this.rbac.canWrite(userId, tenantId, 'table', null);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Изменять чужой вид можно только администратору',
        },
      });
    }
  }
}
