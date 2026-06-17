import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Entity, type TableProperty, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { TableSyncEntityJobData, TableSyncEventType } from '../queues';

import { parseEntitySync, resolveEntityTypes } from './entity-sync.util';
import { TableSyncQueueService } from './table-sync-queue.service';

@Injectable()
export class TableSyncService {
  private readonly logger = new Logger(TableSyncService.name);

  private static readonly SYNC_BACKFILL_LIMIT = 1000;
  private static readonly BACKFILL_BATCH_SIZE = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TableSyncQueueService)
    private readonly queue?: TableSyncQueueService,
  ) {}

  async applyEntityEvent(data: Omit<TableSyncEntityJobData, 'kind'>): Promise<void> {
    const { tenantId, entityId, entityType, eventType } = data;

    const tables = await this.findAutoSyncTables(tenantId, entityType);
    if (tables.length === 0) return;

    if (eventType === 'archived') {
      for (const t of tables) {
        await this.archiveRowForEntity(t.id, tenantId, entityId);
      }
      return;
    }

    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
    });
    if (!entity || entity.tenantId !== tenantId || entity.mergedIntoId !== null) {
      return;
    }

    for (const t of tables) {
      await this.upsertRowForEntity({
        tableId: t.id,
        tenantId,
        properties: t.properties,
        entity,
        eventType,
      });
    }
  }

  async runInitialBackfill(args: {
    tenantId: string;
    tableId: string;
  }): Promise<{ created: number; merged: number; queuedBatches: number }> {
    const table = await this.prisma.table.findUnique({
      where: { id: args.tableId },
      include: { properties: true },
    });
    if (!table || table.tenantId !== args.tenantId || table.deletedAt) {
      return { created: 0, merged: 0, queuedBatches: 0 };
    }
    const sync = parseEntitySync(table.entitySync);
    if (!sync?.autoCreate) return { created: 0, merged: 0, queuedBatches: 0 };

    const types = resolveEntityTypes(sync);
    if (types.length === 0) return { created: 0, merged: 0, queuedBatches: 0 };

    const entities = await this.prisma.entity.findMany({
      where: {
        tenantId: args.tenantId,
        type: { in: types as Entity['type'][] },
        mergedIntoId: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (entities.length === 0) {
      return { created: 0, merged: 0, queuedBatches: 0 };
    }

    if (entities.length > TableSyncService.SYNC_BACKFILL_LIMIT) {
      let queuedBatches = 0;
      if (this.queue) {
        for (let i = 0; i < entities.length; i += TableSyncService.BACKFILL_BATCH_SIZE) {
          const batch = entities
            .slice(i, i + TableSyncService.BACKFILL_BATCH_SIZE)
            .map((e) => e.id);
          await this.queue.enqueueBackfillBatch({
            tenantId: args.tenantId,
            tableId: args.tableId,
            entityIds: batch,
          });
          queuedBatches++;
        }
      } else {
        this.logger.warn(
          { tableId: args.tableId, count: entities.length },
          'runInitialBackfill: >лимита, но очередь недоступна — backfill пропущен',
        );
      }
      return { created: 0, merged: 0, queuedBatches };
    }

    const res = await this.backfillEntities({
      tenantId: args.tenantId,
      tableId: args.tableId,
      properties: table.properties,
      entities,
    });
    return { ...res, queuedBatches: 0 };
  }

  async runBackfillBatch(args: {
    tenantId: string;
    tableId: string;
    entityIds: string[];
  }): Promise<{ created: number; merged: number }> {
    const table = await this.prisma.table.findUnique({
      where: { id: args.tableId },
      include: { properties: true },
    });
    if (!table || table.tenantId !== args.tenantId || table.deletedAt) {
      return { created: 0, merged: 0 };
    }
    const entities = await this.prisma.entity.findMany({
      where: {
        id: { in: args.entityIds },
        tenantId: args.tenantId,
        mergedIntoId: null,
      },
    });
    return this.backfillEntities({
      tenantId: args.tenantId,
      tableId: args.tableId,
      properties: table.properties,
      entities,
    });
  }

  buildEntityCells(properties: TableProperty[], entity: Entity): Record<string, unknown> {
    const cells: Record<string, unknown> = {};
    for (const p of properties) {
      const attr = this.entityAttributeOf(p);
      if (!attr) continue;
      const value = this.entityValue(entity, attr);
      if (value !== null && value !== undefined && value !== '') {
        cells[p.id] = value;
      }
    }
    return cells;
  }

  private async findAutoSyncTables(
    tenantId: string,
    entityType: string,
  ): Promise<Array<{ id: string; properties: TableProperty[] }>> {
    const tables = await this.prisma.table.findMany({
      where: {
        tenantId,
        deletedAt: null,
        archivedAt: null,
        entitySync: { not: Prisma.JsonNull },
      },
      include: { properties: true },
    });
    const out: Array<{ id: string; properties: TableProperty[] }> = [];
    for (const t of tables) {
      const sync = parseEntitySync(t.entitySync);
      if (!sync?.autoCreate) continue;
      const types = resolveEntityTypes(sync);
      if (!types.includes(entityType)) continue;
      out.push({ id: t.id, properties: t.properties });
    }
    return out;
  }

  private async upsertRowForEntity(args: {
    tableId: string;
    tenantId: string;
    properties: TableProperty[];
    entity: Entity;
    eventType: TableSyncEventType;
  }): Promise<void> {
    const existing = await this.prisma.tableRow.findFirst({
      where: {
        tableId: args.tableId,
        entityId: args.entity.id,
        deletedAt: null,
      },
      select: { id: true, cells: true },
    });

    const entityCells = this.buildEntityCells(args.properties, args.entity);

    if (existing) {
      const merged = {
        ...((existing.cells as Record<string, unknown>) ?? {}),
        ...entityCells,
      };
      await this.prisma.tableRow.update({
        where: { id: existing.id },
        data: { cells: merged as Prisma.InputJsonValue },
      });
      return;
    }

    const conflict = await this.findManualConflictRow(args);
    if (conflict) {
      const merged = {
        ...((conflict.cells as Record<string, unknown>) ?? {}),
        ...entityCells,
      };
      await this.prisma.tableRow.update({
        where: { id: conflict.id },
        data: {
          entityId: args.entity.id,
          cells: merged as Prisma.InputJsonValue,
        },
      });
      return;
    }

    await this.prisma.tableRow.create({
      data: {
        tableId: args.tableId,
        tenantId: args.tenantId,
        cells: entityCells as Prisma.InputJsonValue,
        entityId: args.entity.id,
        order: new Prisma.Decimal(await this.nextOrder(args.tableId)),
        createdBy: 'system',
      },
    });
  }

  private async archiveRowForEntity(
    tableId: string,
    tenantId: string,
    entityId: string,
  ): Promise<void> {
    const row = await this.prisma.tableRow.findFirst({
      where: { tableId, tenantId, entityId, deletedAt: null, archivedAt: null },
      select: { id: true },
    });
    if (!row) return;
    await this.prisma.tableRow.update({
      where: { id: row.id },
      data: { archivedAt: new Date() },
    });
  }

  private async backfillEntities(args: {
    tenantId: string;
    tableId: string;
    properties: TableProperty[];
    entities: Entity[];
  }): Promise<{ created: number; merged: number }> {
    if (args.entities.length === 0) return { created: 0, merged: 0 };

    const existingRows = await this.prisma.tableRow.findMany({
      where: {
        tableId: args.tableId,
        entityId: { in: args.entities.map((e) => e.id) },
        deletedAt: null,
      },
      select: { entityId: true },
    });
    const linked = new Set(existingRows.map((r) => r.entityId).filter((id): id is string => !!id));

    let merged = 0;
    const toCreate: Array<{ entity: Entity; cells: Record<string, unknown> }> = [];

    for (const entity of args.entities) {
      if (linked.has(entity.id)) continue;
      const cells = this.buildEntityCells(args.properties, entity);

      const conflict = await this.findManualConflictRow({
        tableId: args.tableId,
        tenantId: args.tenantId,
        properties: args.properties,
        entity,
      });
      if (conflict) {
        const mergedCells = {
          ...((conflict.cells as Record<string, unknown>) ?? {}),
          ...cells,
        };
        await this.prisma.tableRow.update({
          where: { id: conflict.id },
          data: {
            entityId: entity.id,
            cells: mergedCells as Prisma.InputJsonValue,
          },
        });
        merged++;
        linked.add(entity.id);
        continue;
      }
      toCreate.push({ entity, cells });
    }

    let created = 0;
    if (toCreate.length > 0) {
      let order = await this.nextOrder(args.tableId);
      const rows = toCreate.map(({ entity, cells }) => ({
        tableId: args.tableId,
        tenantId: args.tenantId,
        cells: cells as Prisma.InputJsonValue,
        entityId: entity.id,
        order: new Prisma.Decimal(order++),
        createdBy: 'system',
      }));
      const res = await this.prisma.tableRow.createMany({ data: rows });
      created = res.count;
    }

    return { created, merged };
  }

  private async findManualConflictRow(args: {
    tableId: string;
    tenantId: string;
    properties: TableProperty[];
    entity: Entity;
  }): Promise<{ id: string; cells: Prisma.JsonValue } | null> {
    const primaryProp = args.properties.find((p) => this.entityAttributeOf(p) === 'canonicalName');
    const emailProp = args.properties.find((p) => this.entityAttributeOf(p) === 'email');
    if (!primaryProp && !emailProp) return null;

    const nameKey = this.norm(args.entity.canonicalName);
    const emailKey = this.norm(args.entity.email ?? '');

    const rows = await this.prisma.tableRow.findMany({
      where: {
        tableId: args.tableId,
        tenantId: args.tenantId,
        entityId: null,
        deletedAt: null,
        archivedAt: null,
      },
      select: { id: true, cells: true },
    });
    for (const r of rows) {
      const cells = (r.cells as Record<string, unknown>) ?? {};
      if (
        primaryProp &&
        nameKey.length > 0 &&
        this.norm(this.cellText(cells[primaryProp.id])) === nameKey
      ) {
        return r;
      }
      if (
        emailProp &&
        emailKey.length > 0 &&
        this.norm(this.cellText(cells[emailProp.id])) === emailKey
      ) {
        return r;
      }
    }
    return null;
  }

  private entityAttributeOf(p: TableProperty): string | null {
    const cfg = (p.config as Record<string, unknown> | null) ?? {};
    if (cfg['source'] !== 'entity') return null;
    const attr = cfg['entityAttribute'];
    return typeof attr === 'string' && attr.length > 0 ? attr : null;
  }

  private entityValue(entity: Entity, attribute: string): unknown {
    switch (attribute) {
      case 'canonicalName':
        return entity.canonicalName;
      case 'email':
        return entity.email;
      case 'phone':
        return entity.phone;
      case 'domain':
        return entity.domain;
      case 'inn':
        return entity.inn;
      case 'ogrn':
        return entity.ogrn;
      default: {
        const meta = (entity.metadata as Record<string, unknown> | null) ?? null;
        return meta && attribute in meta ? meta[attribute] : null;
      }
    }
  }

  private cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return '';
  }

  private norm(s: string): string {
    return s.trim().toLowerCase();
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
}
