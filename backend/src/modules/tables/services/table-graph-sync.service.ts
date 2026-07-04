import { Inject, Injectable, Logger } from '@nestjs/common';
import { type TableProperty, type SignalType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { buildProvenanceDeepLink } from '../../knowledge-core/services/provenance.service';

export type GraphSyncSource = 'idea_block' | 'goal' | 'experiment';

export interface GraphSyncConfig {
  source: GraphSyncSource;
  signalType?: string;
  signalTypes?: string[];
  fieldMap: Record<string, string>;
  autoCreate: boolean;
  preferredEntityTypes?: string[];
}

export interface GraphSyncObject {
  id: string;
  name?: string | null;
  confidence?: number | Prisma.Decimal | null;
  resolvedEntityId?: string | null;
  [field: string]: unknown;
}

interface EntityLinkLite {
  entityId: string;
  role: string;
  type: string;
  mentionsCount: number;
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
  entityId: string | null;
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
    const signalTypesRaw = obj['signalTypes'];
    const signalTypes = Array.isArray(signalTypesRaw)
      ? signalTypesRaw.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : undefined;
    const preferredRaw = obj['preferredEntityTypes'];
    const preferredEntityTypes = Array.isArray(preferredRaw)
      ? preferredRaw.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : undefined;
    return {
      source,
      signalType: typeof obj['signalType'] === 'string' ? (obj['signalType'] as string) : undefined,
      signalTypes: signalTypes && signalTypes.length > 0 ? signalTypes : undefined,
      fieldMap,
      autoCreate: obj['autoCreate'] === true,
      preferredEntityTypes:
        preferredEntityTypes && preferredEntityTypes.length > 0 ? preferredEntityTypes : undefined,
    };
  }

  private effectiveSignalTypes(graphSync: GraphSyncConfig): string[] | null {
    if (graphSync.signalTypes && graphSync.signalTypes.length > 0) return graphSync.signalTypes;
    if (graphSync.signalType) return [graphSync.signalType];
    return null;
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
      const [enriched] = await this.resolveEntityIds(
        args.tenantId,
        args.source,
        [args.object],
        table.graphSync.preferredEntityTypes ?? [],
      );
      const single = await this.applyObject({
        tenantId: args.tenantId,
        table,
        object: enriched ?? args.object,
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
    if (source === 'idea_block') {
      const types = this.effectiveSignalTypes(graphSync);
      if (types) {
        const signalType = typeof object['signalType'] === 'string' ? object['signalType'] : null;
        if (!signalType || !types.includes(signalType)) return false;
      }
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

    const sourceLabel = this.stringOrNull(args.object['sourceLabel']) ?? this.objectLabel(args.object);
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
          entityId: args.object.resolvedEntityId ?? null,
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
      select: { id: true, cells: true, status: true, entityId: true },
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
    const candidate: Record<string, unknown> = {};
    for (const [propertyId, value] of Object.entries(args.filledCells)) {
      if (this.isEmptyCell(currentCells[propertyId])) {
        candidate[propertyId] = value;
      }
    }
    const protectedProps =
      Object.keys(candidate).length > 0
        ? await this.loadHumanTouchedProps(args.tenantId, args.existing.id)
        : new Set<string>();
    const toFill: Record<string, unknown> = {};
    for (const [propertyId, value] of Object.entries(candidate)) {
      if (!protectedProps.has(propertyId)) toFill[propertyId] = value;
    }

    const hasCellFill = Object.keys(toFill).length > 0;
    const resolvedEntityId = args.object.resolvedEntityId ?? null;
    const linkEntity = args.existing.entityId === null && resolvedEntityId !== null;
    const promote = args.existing.status === 'draft' && args.status === 'active';
    if (!hasCellFill && !promote && !linkEntity) return 'updated';

    const data: Record<string, unknown> = {};
    if (hasCellFill) data.cells = { ...currentCells, ...toFill } as Prisma.InputJsonValue;
    if (linkEntity) data.entityId = resolvedEntityId;
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

  private async loadHumanTouchedProps(tenantId: string, rowId: string): Promise<Set<string>> {
    const rows = await this.prisma.tableCellProvenance.findMany({
      where: { tenantId, tableRowId: rowId },
      select: { propertyId: true, appliedBy: true, rolledBackAt: true },
    });
    const out = new Set<string>();
    for (const r of rows) {
      if (r.appliedBy !== 'agent' || r.rolledBackAt !== null) out.add(r.propertyId);
    }
    return out;
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
          sourceLink: this.stringOrNull(args.object['sourceLink']),
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
    const preferredTypes = graphSync.preferredEntityTypes ?? [];

    if (graphSync.source === 'goal') {
      const goals = await this.prisma.goal.findMany({
        where: { tenantId, archivedAt: null },
        select: { id: true, name: true, targetDate: true, confidence: true, entityId: true },
        ...page,
      });
      const objects: GraphSyncObject[] = goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetDate: g.targetDate,
        confidence: g.confidence,
        entityId: g.entityId,
      }));
      return this.resolveEntityIds(tenantId, 'goal', objects, preferredTypes);
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
          ownerEntityId: true,
          personSubjectIds: true,
        },
        ...page,
      });
      const objects: GraphSyncObject[] = experiments.map((e) => ({
        id: e.id,
        name: e.name,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        currentResult: e.currentResult,
        confidence: e.confidence,
        ownerEntityId: e.ownerEntityId,
        personSubjectIds: e.personSubjectIds,
      }));
      return this.resolveEntityIds(tenantId, 'experiment', objects, preferredTypes);
    }

    const types = this.effectiveSignalTypes(graphSync);
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        ...(types ? { signalType: { in: types as SignalType[] } } : {}),
        status: 'canonical',
        mergedIntoId: null,
      },
      select: {
        id: true,
        name: true,
        signalType: true,
        commitmentDueDate: true,
        confidence: true,
        commitmentAuthorPersonId: true,
        commitmentRecipientPersonId: true,
      },
      ...page,
    });
    const objects: GraphSyncObject[] = blocks.map((b) => ({
      id: b.id,
      name: b.name,
      signalType: b.signalType,
      commitmentDueDate: b.commitmentDueDate,
      confidence: b.confidence,
      commitmentAuthorPersonId: b.commitmentAuthorPersonId,
      commitmentRecipientPersonId: b.commitmentRecipientPersonId,
    }));
    return this.resolveEntityIds(tenantId, 'idea_block', objects, preferredTypes);
  }

  async resolveEntityIds(
    tenantId: string,
    source: GraphSyncSource,
    objects: GraphSyncObject[],
    preferredTypes: string[],
  ): Promise<GraphSyncObject[]> {
    if (objects.length === 0) return objects;

    if (source === 'goal') {
      for (const o of objects) {
        o.resolvedEntityId = this.stringOrNull(o['entityId']);
      }
      return objects;
    }

    if (source === 'experiment') {
      const personIds = new Set<string>();
      for (const o of objects) {
        if (!this.stringOrNull(o['ownerEntityId'])) {
          const first = this.firstPersonId(o['personSubjectIds']);
          if (first) personIds.add(first);
        }
      }
      const personEntity = await this.loadPersonEntityMap(tenantId, [...personIds]);
      for (const o of objects) {
        const owner = this.stringOrNull(o['ownerEntityId']);
        if (owner) {
          o.resolvedEntityId = owner;
          continue;
        }
        const first = this.firstPersonId(o['personSubjectIds']);
        o.resolvedEntityId = first ? (personEntity.get(first) ?? null) : null;
      }
      return objects;
    }

    const blockIds = objects.map((o) => o.id);
    const linksByBlock = await this.loadBlockEntityLinks(tenantId, blockIds);
    const sourcesByBlock = await this.loadBlockSources(tenantId, blockIds);
    const personIds = new Set<string>();
    for (const o of objects) {
      const author = this.stringOrNull(o['commitmentAuthorPersonId']);
      const recipient = this.stringOrNull(o['commitmentRecipientPersonId']);
      if (author) personIds.add(author);
      if (recipient) personIds.add(recipient);
    }
    const personEntity = await this.loadPersonEntityMap(tenantId, [...personIds]);
    for (const o of objects) {
      const primary = this.pickPrimaryEntity(linksByBlock.get(o.id) ?? [], preferredTypes);
      const recipient = this.stringOrNull(o['commitmentRecipientPersonId']);
      const author = this.stringOrNull(o['commitmentAuthorPersonId']);
      const recipientEntity = recipient ? (personEntity.get(recipient) ?? null) : null;
      const authorEntity = author ? (personEntity.get(author) ?? null) : null;
      o.resolvedEntityId = primary ?? recipientEntity ?? authorEntity ?? null;
      const src = sourcesByBlock.get(o.id);
      if (src) {
        o['sourceLink'] = src.sourceLink;
        o['sourceLabel'] = src.sourceLabel;
      }
    }
    return objects;
  }

  private async loadBlockSources(
    tenantId: string,
    blockIds: string[],
  ): Promise<Map<string, { sourceLink: string; sourceLabel: string }>> {
    const out = new Map<string, { sourceLink: string; sourceLabel: string }>();
    if (blockIds.length === 0) return out;
    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { tenantId, blockId: { in: blockIds } },
      select: {
        blockId: true,
        startMs: true,
        sourceTimestamp: true,
        rawEvent: { select: { sourceType: true, sourceExternalId: true } },
      },
      orderBy: { sourceTimestamp: 'asc' },
    });
    for (const e of evidence) {
      if (out.has(e.blockId)) continue;
      const rt = e.rawEvent;
      if (!rt || rt.sourceType !== 'meeting' || !rt.sourceExternalId) continue;
      const link = buildProvenanceDeepLink({
        sourceType: 'meeting',
        externalId: rt.sourceExternalId,
        startMs: e.startMs ?? undefined,
      });
      if (!link) continue;
      const dateLabel = e.sourceTimestamp
        ? ` от ${e.sourceTimestamp.toISOString().slice(0, 10)}`
        : '';
      out.set(e.blockId, { sourceLink: link, sourceLabel: `Встреча${dateLabel}` });
    }
    return out;
  }

  pickPrimaryEntity(links: EntityLinkLite[], preferredTypes: string[]): string | null {
    if (links.length === 0) return null;
    const roleRank = (r: string): number => (r === 'subject' ? 0 : r === 'object' ? 1 : 2);
    const typeRank = (t: string): number => {
      const i = preferredTypes.indexOf(t);
      return i === -1 ? preferredTypes.length : i;
    };
    const sorted = [...links].sort((a, b) => {
      const ta = typeRank(a.type);
      const tb = typeRank(b.type);
      if (ta !== tb) return ta - tb;
      const ra = roleRank(a.role);
      const rb = roleRank(b.role);
      if (ra !== rb) return ra - rb;
      if (a.mentionsCount !== b.mentionsCount) return b.mentionsCount - a.mentionsCount;
      return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
    });
    return sorted[0]?.entityId ?? null;
  }

  private async loadBlockEntityLinks(
    tenantId: string,
    blockIds: string[],
  ): Promise<Map<string, EntityLinkLite[]>> {
    const out = new Map<string, EntityLinkLite[]>();
    if (blockIds.length === 0) return out;
    const links = await this.prisma.ideaBlockEntity.findMany({
      where: { tenantId, blockId: { in: blockIds } },
      select: {
        blockId: true,
        entityId: true,
        role: true,
        entity: { select: { type: true, mentionsCount: true, mergedIntoId: true } },
      },
    });
    for (const l of links) {
      if (!l.entity || l.entity.mergedIntoId !== null) continue;
      const list = out.get(l.blockId) ?? [];
      list.push({
        entityId: l.entityId,
        role: String(l.role),
        type: String(l.entity.type),
        mentionsCount: l.entity.mentionsCount,
      });
      out.set(l.blockId, list);
    }
    return out;
  }

  private async loadPersonEntityMap(
    tenantId: string,
    personIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (personIds.length === 0) return out;
    const persons = await this.prisma.person.findMany({
      where: { tenantId, id: { in: personIds }, entityId: { not: null } },
      select: { id: true, entityId: true },
    });
    for (const p of persons) {
      if (p.entityId) out.set(p.id, p.entityId);
    }
    return out;
  }

  private stringOrNull(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  private firstPersonId(v: unknown): string | null {
    if (!Array.isArray(v)) return null;
    for (const x of v) {
      if (typeof x === 'string' && x.length > 0) return x;
    }
    return null;
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
