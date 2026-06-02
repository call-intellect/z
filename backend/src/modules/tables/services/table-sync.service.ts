import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Entity, type TableProperty, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { TableSyncEntityJobData, TableSyncEventType } from '../queues';

import {
  parseEntitySync,
  resolveEntityTypes,
} from './entity-sync.util';
import { TableSyncQueueService } from './table-sync-queue.service';

/**
 * TableSyncService (Smart-tables Фаза 2 — graph-driven rows).
 *
 * Поддерживает строки системных entitySync-таблиц в актуальном состоянии:
 *   - Entity created → в каждой подходящей таблице создаётся строка с
 *     entityId и заполненными entity-атрибутами (read-only ячейки);
 *   - Entity updated → у существующих строк обновляются ТОЛЬКО read-only
 *     entity-ячейки; ручные ячейки не трогаются;
 *   - Entity archived (merged) → строка помечается archivedAt.
 *
 * Идемпотентность: строка ищется по (tableId, entityId); повторное событие не
 * создаёт дубль. Конфликт-резолвер: ручная строка с совпадающим primary/email
 * сливается с Entity (проставляется entityId), а не дублируется.
 *
 * `entityAttribute` извлекается из `TableProperty.config` (source==='entity').
 * Эти же колонки — read-only (см. TableRowsService guard).
 */
@Injectable()
export class TableSyncService {
  private readonly logger = new Logger(TableSyncService.name);

  /** Лимит строк для синхронного backfill; выше — фоновые батчи. */
  private static readonly SYNC_BACKFILL_LIMIT = 1000;
  private static readonly BACKFILL_BATCH_SIZE = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // @Optional: в unit-тестах backfill через очередь можно не передавать
    // (синхронный путь ≤1000 строк работает без очереди).
    @Optional()
    @Inject(TableSyncQueueService)
    private readonly queue?: TableSyncQueueService,
  ) {}

  // ─────────────────────────── event apply ────────────────────────────────

  /**
   * Реакция на событие графа. Находит все автосинк-таблицы tenant'а, чей набор
   * классов Entity включает `entityType`, и применяет операцию.
   */
  async applyEntityEvent(
    data: Omit<TableSyncEntityJobData, 'kind'>,
  ): Promise<void> {
    const { tenantId, entityId, entityType, eventType } = data;

    const tables = await this.findAutoSyncTables(tenantId, entityType);
    if (tables.length === 0) return;

    if (eventType === 'archived') {
      for (const t of tables) {
        await this.archiveRowForEntity(t.id, tenantId, entityId);
      }
      return;
    }

    // created / updated требуют сам Entity (для значений ячеек).
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
    });
    // Если сущность исчезла или уже merged — нечего синкать (created/updated).
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

  // ─────────────────────────── initial backfill ───────────────────────────

  /**
   * Наполнить таблицу строками по всем «живым» Entity её классов. Вызывается
   * при включении autoCreate (TablesService.update) и backfill-скриптом.
   *
   * Идемпотентно: пропускает Entity, у которых уже есть строка. ≤ лимита —
   * синхронно (createMany + конфликт-резолвер); выше — фоновые батчи в очередь.
   */
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
      // Большая Org → фоновые батчи (если очередь доступна).
      let queuedBatches = 0;
      if (this.queue) {
        for (
          let i = 0;
          i < entities.length;
          i += TableSyncService.BACKFILL_BATCH_SIZE
        ) {
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

    // Синхронный путь.
    const res = await this.backfillEntities({
      tenantId: args.tenantId,
      tableId: args.tableId,
      properties: table.properties,
      entities,
    });
    return { ...res, queuedBatches: 0 };
  }

  /**
   * Обработать один батч initial-backfill (вызывается воркером для больших Org).
   */
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

  // ─────────────────────────── cells builder ──────────────────────────────

  /**
   * Собрать cells `{ [propertyId]: value }` ТОЛЬКО для колонок, связанных с
   * Entity (config.source==='entity'), извлекая значение по entityAttribute.
   * Пустые/отсутствующие атрибуты пропускаются.
   */
  buildEntityCells(
    properties: TableProperty[],
    entity: Entity,
  ): Record<string, unknown> {
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

  // ─────────────────────────── private helpers ────────────────────────────

  /**
   * Найти все НЕ-archived автосинк-таблицы tenant'а, чей набор классов Entity
   * включает `entityType`. Подтягиваем только таблицы с непустым entitySync
   * (Prisma `entitySync: { not: JsonNull }`), затем фильтруем в коде по JSON
   * (autoCreate + resolveEntityTypes) — это надёжнее, чем JSON-path фильтр
   * (entityTypes может отсутствовать, тогда работает дефолт по type).
   */
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

  /**
   * created/updated: найти строку по (tableId, entityId) → если нет, создать
   * (с учётом конфликт-резолвера); если есть — обновить ТОЛЬКО entity-ячейки.
   */
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
      // Обновляем только entity-ячейки, ручные не трогаем.
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

    // Строки с этим entityId нет. Конфликт-резолвер: вдруг есть ручная строка
    // (entityId=null) с совпадающим primary/email — сливаем её, а не дублируем.
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

    // На 'updated' без существующей строки тоже создаём (граф мог пропустить
    // created — синк должен быть самовосстанавливающимся).
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

  /**
   * Backfill набора Entity в таблицу. Идемпотентно: пропускает Entity, у
   * которых уже есть строка; ручные конфликты сливает; остальное — createMany.
   */
  private async backfillEntities(args: {
    tenantId: string;
    tableId: string;
    properties: TableProperty[];
    entities: Entity[];
  }): Promise<{ created: number; merged: number }> {
    if (args.entities.length === 0) return { created: 0, merged: 0 };

    // 1. Уже привязанные строки — пропускаем.
    const existingRows = await this.prisma.tableRow.findMany({
      where: {
        tableId: args.tableId,
        entityId: { in: args.entities.map((e) => e.id) },
        deletedAt: null,
      },
      select: { entityId: true },
    });
    const linked = new Set(
      existingRows.map((r) => r.entityId).filter((id): id is string => !!id),
    );

    let merged = 0;
    const toCreate: Array<{ entity: Entity; cells: Record<string, unknown> }> = [];

    for (const entity of args.entities) {
      if (linked.has(entity.id)) continue;
      const cells = this.buildEntityCells(args.properties, entity);

      // Конфликт-резолвер на ручную строку.
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

  /**
   * Найти ручную строку (entityId=null) этой таблицы, совпадающую по primary
   * (canonicalName) ИЛИ по email с Entity. Используется конфликт-резолвером,
   * чтобы не плодить дубли при backfill/create.
   *
   * Совпадение проверяем в коде по cells (JSON), потому что значения лежат под
   * id колонки, а сравнение — case-insensitive trim.
   */
  private async findManualConflictRow(args: {
    tableId: string;
    tenantId: string;
    properties: TableProperty[];
    entity: Entity;
  }): Promise<{ id: string; cells: Prisma.JsonValue } | null> {
    const primaryProp = args.properties.find(
      (p) => this.entityAttributeOf(p) === 'canonicalName',
    );
    const emailProp = args.properties.find(
      (p) => this.entityAttributeOf(p) === 'email',
    );
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

  /** Имя entity-атрибута колонки (config.source==='entity'), либо null. */
  private entityAttributeOf(p: TableProperty): string | null {
    const cfg = (p.config as Record<string, unknown> | null) ?? {};
    if (cfg['source'] !== 'entity') return null;
    const attr = cfg['entityAttribute'];
    return typeof attr === 'string' && attr.length > 0 ? attr : null;
  }

  /** Значение entity-атрибута (поддерживаем плоские поля Entity). */
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
        // metadata.<attr> как fallback.
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
