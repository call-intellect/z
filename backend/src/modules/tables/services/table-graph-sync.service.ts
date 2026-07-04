import { Inject, Injectable, Logger } from '@nestjs/common';
import { type TableProperty, type SignalType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

export type GraphSyncSource = 'idea_block' | 'goal' | 'experiment';

export interface GraphSyncConfig {
  source: GraphSyncSource;
  signalType?: string;
  fieldMap: Record<string, string>;
  autoCreate: boolean;
}

export interface GraphSyncObject {
  id: string;
  name?: string | null;
  confidence?: number | Prisma.Decimal | null;
  [field: string]: unknown;
}

interface GraphSyncTable {
  id: string;
  graphSync: GraphSyncConfig;
  properties: TableProperty[];
}

interface ExistingRow {
  id: string;
  cells: Prisma.JsonValue;
  status: string;
}

export type SyncOutcome = 'created' | 'updated' | 'skipped';
export type RowStatus = 'active' | 'draft';

export interface ReconcileResult {
  created: number;
  updated: number;
  skipped: number;
}

const DEFAULT_GRAPHSYNC_ENABLED = true;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_DRAFT_TTL_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const RECONCILE_PAGE_SIZE = 500;
const DATE_FIELDS = new Set<string>(['commitmentDueDate', 'targetDate', 'startedAt', 'completedAt']);

@Injectable()
export class TableGraphSyncService {
  private readonly logger = new Logger(TableGraphSyncService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const v = await this.cfg.getDynamic<boolean>(
      'table.graphsync.enabled',
      undefined,
      DEFAULT_GRAPHSYNC_ENABLED,
    );
    return typeof v === 'boolean' ? v : DEFAULT_GRAPHSYNC_ENABLED;
  }

  async minConfidence(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'table.graphsync.min_confidence',
      undefined,
      DEFAULT_MIN_CONFIDENCE,
    );
    const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_MIN_CONFIDENCE;
    return Math.min(Math.max(n, 0), 1);
  }

  async draftTtlDays(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'table.agent.draft_ttl_days',
      undefined,
      DEFAULT_DRAFT_TTL_DAYS,
    );
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : DEFAULT_DRAFT_TTL_DAYS;
    return Math.max(n, 1);
  }

  parseGraphSync(json: unknown): GraphSyncConfig | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const obj = json as Record<string, unknown>;
    const source = obj['source'];
    if (source !== 'idea_block' && source !== 'goal' && source !== 'experiment') return null;
    const fieldMapRaw = obj['fieldMap'];
    if (!fieldMapRaw || typeof fieldMapRaw !== 'object' || Array.isArray(fieldMapRaw)) return null;
    const fieldMap: Record<string, string> = {};
    for (const [k, val] of Object.entries(fieldMapRaw as Record<string, unknown>)) {
      if (typeof val === 'string' && val.length > 0) fieldMap[k] = val;
    }
    return {
      source,
      signalType: typeof obj['signalType'] === 'string' ? (obj['signalType'] as string) : undefined,
      fieldMap,
      autoCreate: obj['autoCreate'] === true,
    };
  }

  async findGraphSyncTables(tenantId: string): Promise<GraphSyncTable[]> {
    const tables = await this.prisma.table.findMany({
      where: {
        tenantId,
        deletedAt: null,
        archivedAt: null,
        graphSync: { not: Prisma.JsonNull },
      },
      include: { properties: true },
    });
    const out: GraphSyncTable[] = [];
    for (const t of tables) {
      const graphSync = this.parseGraphSync(t.graphSync);
      if (!graphSync?.autoCreate) continue;
      out.push({ id: t.id, graphSync, properties: t.properties });
    }
    return out;
  }

  async syncObject(args: {
    tenantId: string;
    source: GraphSyncSource;
    object: GraphSyncObject;
  }): Promise<SyncOutcome> {
    if (!(await this.isEnabled())) return 'skipped';

    const tables = await this.findGraphSyncTables(args.tenantId);
    const targets = tables.filter((t) => this.matchesSource(t.graphSync, args.source, args.object));
    if (targets.length === 0) return 'skipped';

    const min = await this.minConfidence();
    const ttlDays = await this.draftTtlDays();
    const now = Date.now();
    let outcome: SyncOutcome = 'skipped';
    for (const table of targets) {
      const single = await this.applyObject({
        tenantId: args.tenantId,
        table,
        object: args.object,
        min,
        ttlDays,
        now,
      });
      if (single === 'created') outcome = 'created';
      else if (single === 'updated' && outcome !== 'created') outcome = 'updated';
    }
    return outcome;
  }

  async reconcileTenant(tenantId: string): Promise<ReconcileResult> {
    const result: ReconcileResult = { created: 0, updated: 0, skipped: 0 };
    if (!(await this.isEnabled())) return result;

    const min = await this.minConfidence();
    const ttlDays = await this.draftTtlDays();
    const now = Date.now();
    const tables = await this.findGraphSyncTables(tenantId);
    for (const table of tables) {
      let offset = 0;
      for (;;) {
        const objects = await this.loadLiveObjectsPage(tenantId, table.graphSync, offset);
        for (const object of objects) {
          const outcome = await this.applyObject({ tenantId, table, object, min, ttlDays, now });
          result[outcome]++;
        }
        if (objects.length < RECONCILE_PAGE_SIZE) break;
        offset += RECONCILE_PAGE_SIZE;
      }
    }
    return result;
  }

  async expireDrafts(tenantId: string, now: number = Date.now()): Promise<number> {
    const res = await this.prisma.tableRow.updateMany({
      where: {
        tenantId,
        status: 'draft',
        deletedAt: null,
        draftExpiresAt: { lte: new Date(now) },
      },
      data: { deletedAt: new Date(now) },
    });
    return res.count;
  }

  private async applyObject(args: {
    tenantId: string;
    table: GraphSyncTable;
    object: GraphSyncObject;
    min: number;
    ttlDays: number;
    now: number;
  }): Promise<SyncOutcome> {
    const raw = args.object.confidence;
    const effConf = raw === null || raw === undefined ? 1 : Number(raw.toString());
    const confidence = Number.isFinite(effConf) ? effConf : 1;
    const status: RowStatus = confidence >= args.min ? 'active' : 'draft';
    const draftExpiresAt = status === 'draft' ? new Date(args.now + args.ttlDays * MS_PER_DAY) : null;
    return this.syncIntoTable({
      tenantId: args.tenantId,
      source: args.table.graphSync.source,
      object: args.object,
      table: args.table,
      confidence,
      status,
      draftExpiresAt,
    });
  }

  private matchesSource(
    graphSync: GraphSyncConfig,
    source: GraphSyncSource,
    object: GraphSyncObject,
  ): boolean {
    if (graphSync.source !== source) return false;
    if (source === 'idea_block' && graphSync.signalType) {
      const signalType = typeof object['signalType'] === 'string' ? object['signalType'] : null;
      if (signalType !== graphSync.signalType) return false;
    }
    return true;
  }

  private async syncIntoTable(args: {
    tenantId: string;
    source: GraphSyncSource;
    object: GraphSyncObject;
    table: GraphSyncTable;
    confidence: number;
    status: RowStatus;
    draftExpiresAt: Date | null;
  }): Promise<SyncOutcome> {
    const filledCells = this.buildCells(args.table, args.object);
    if (Object.keys(filledCells).length === 0) return 'skipped';

    const sourceLabel = this.objectLabel(args.object);
    const existing = await this.findExistingRow(args.tenantId, args.table.id, args.source, args.object.id);
    if (existing) {
      return this.fillExisting({
        tenantId: args.tenantId,
        existing,
        filledCells,
        source: args.source,
        object: args.object,
        sourceLabel,
        confidence: args.confidence,
        status: args.status,
      });
    }

    try {
      const order = await this.nextOrder(args.table.id);
      const row = await this.prisma.tableRow.create({
        data: {
          tableId: args.table.id,
          tenantId: args.tenantId,
          cells: filledCells as Prisma.InputJsonValue,
          entityId: null,
          order: new Prisma.Decimal(order),
          createdBy: 'system',
          status: args.status,
          draftExpiresAt: args.draftExpiresAt,
          sourceObjectType: args.source,
          sourceObjectId: args.object.id,
        },
        select: { id: true },
      });
      await this.writeProvenance({
        tenantId: args.tenantId,
        rowId: row.id,
        cells: filledCells,
        source: args.source,
        object: args.object,
        sourceLabel,
        confidence: args.confidence,
      });
      return 'created';
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        const raced = await this.findExistingRow(args.tenantId, args.table.id, args.source, args.object.id);
        if (raced) {
          return this.fillExisting({
            tenantId: args.tenantId,
            existing: raced,
            filledCells,
            source: args.source,
            object: args.object,
            sourceLabel,
            confidence: args.confidence,
            status: args.status,
          });
        }
      }
      throw e;
    }
  }

  private async findExistingRow(
    tenantId: string,
    tableId: string,
    source: GraphSyncSource,
    sourceObjectId: string,
  ): Promise<ExistingRow | null> {
    return this.prisma.tableRow.findFirst({
      where: { tenantId, tableId, sourceObjectType: source, sourceObjectId, deletedAt: null },
      select: { id: true, cells: true, status: true },
    });
  }

  private async fillExisting(args: {
    tenantId: string;
    existing: ExistingRow;
    filledCells: Record<string, unknown>;
    source: GraphSyncSource;
    object: GraphSyncObject;
    sourceLabel: string;
    confidence: number;
    status: RowStatus;
  }): Promise<SyncOutcome> {
    const currentCells = (args.existing.cells as Record<string, unknown> | null) ?? {};
    const toFill: Record<string, unknown> = {};
    for (const [propertyId, value] of Object.entries(args.filledCells)) {
      if (this.isEmptyCell(currentCells[propertyId])) {
        toFill[propertyId] = value;
      }
    }
    const hasCellFill = Object.keys(toFill).length > 0;
    const promote = args.existing.status === 'draft' && args.status === 'active';
    if (!hasCellFill && !promote) return 'updated';

    const data: Record<string, unknown> = {};
    if (hasCellFill) data.cells = { ...currentCells, ...toFill } as Prisma.InputJsonValue;
    if (promote) {
      data.status = 'active';
      data.draftExpiresAt = null;
    }
    await this.prisma.tableRow.update({
      where: { id: args.existing.id },
      data: data as Prisma.TableRowUpdateInput,
    });
    if (hasCellFill) {
      await this.writeProvenance({
        tenantId: args.tenantId,
        rowId: args.existing.id,
        cells: toFill,
        source: args.source,
        object: args.object,
        sourceLabel: args.sourceLabel,
        confidence: args.confidence,
      });
    }
    return 'updated';
  }

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  private buildCells(table: GraphSyncTable, object: GraphSyncObject): Record<string, unknown> {
    const propByName = new Map<string, TableProperty>();
    for (const p of table.properties) propByName.set(p.name, p);

    const cells: Record<string, unknown> = {};
    for (const [propName, srcField] of Object.entries(table.graphSync.fieldMap)) {
      const prop = propByName.get(propName);
      if (!prop) continue;
      const raw = object[srcField];
      const value = this.normalizeValue(srcField, raw);
      if (this.isEmptyCell(value)) continue;
      cells[prop.id] = value;
    }
    return cells;
  }

  private normalizeValue(field: string, raw: unknown): unknown {
    if (raw === null || raw === undefined) return null;
    if (raw instanceof Date) return raw.toISOString();
    if (DATE_FIELDS.has(field) && typeof raw === 'string' && raw.length > 0) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return raw;
  }

  private async writeProvenance(args: {
    tenantId: string;
    rowId: string;
    cells: Record<string, unknown>;
    source: GraphSyncSource;
    object: GraphSyncObject;
    sourceLabel: string;
    confidence: number;
  }): Promise<void> {
    for (const [propertyId, value] of Object.entries(args.cells)) {
      await this.prisma.tableCellProvenance.create({
        data: {
          tenantId: args.tenantId,
          tableRowId: args.rowId,
          propertyId,
          sourceType: args.source,
          sourceId: args.object.id,
          sourceLabel: args.sourceLabel,
          sourceLink: null,
          previousValue: Prisma.JsonNull,
          appliedValue: value as Prisma.InputJsonValue,
          confidence: new Prisma.Decimal(this.clampConfidence(args.confidence)),
          appliedBy: 'agent',
        },
      });
    }
  }

  private async loadLiveObjectsPage(
    tenantId: string,
    graphSync: GraphSyncConfig,
    offset: number,
  ): Promise<GraphSyncObject[]> {
    const page = {
      take: RECONCILE_PAGE_SIZE,
      skip: offset,
      orderBy: { id: 'asc' as const },
    };

    if (graphSync.source === 'goal') {
      const goals = await this.prisma.goal.findMany({
        where: { tenantId, archivedAt: null },
        select: { id: true, name: true, targetDate: true, confidence: true },
        ...page,
      });
      return goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetDate: g.targetDate,
        confidence: g.confidence,
      }));
    }

    if (graphSync.source === 'experiment') {
      const experiments = await this.prisma.experiment.findMany({
        where: { tenantId, status: { not: 'dropped' } },
        select: {
          id: true,
          name: true,
          startedAt: true,
          completedAt: true,
          currentResult: true,
          confidence: true,
        },
        ...page,
      });
      return experiments.map((e) => ({
        id: e.id,
        name: e.name,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        currentResult: e.currentResult,
        confidence: e.confidence,
      }));
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        ...(graphSync.signalType ? { signalType: graphSync.signalType as SignalType } : {}),
        status: 'canonical',
        mergedIntoId: null,
      },
      select: {
        id: true,
        name: true,
        signalType: true,
        commitmentDueDate: true,
        confidence: true,
      },
      ...page,
    });
    return blocks.map((b) => ({
      id: b.id,
      name: b.name,
      signalType: b.signalType,
      commitmentDueDate: b.commitmentDueDate,
      confidence: b.confidence,
    }));
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

  private objectLabel(object: GraphSyncObject): string {
    const name = typeof object.name === 'string' ? object.name.trim() : '';
    return name || 'объект графа';
  }

  private isEmptyCell(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private clampConfidence(c: number): number {
    const n = Number.isFinite(c) ? c : 0;
    return Math.round(Math.min(Math.max(n, 0), 1) * 100) / 100;
  }
}
