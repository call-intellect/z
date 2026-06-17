import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { parseNumericLoose } from './_num.util';
import { parseEntitySync } from './entity-sync.util';
import type { InferredTableSchema } from './table-agent.service';
import { TableAgentService } from './table-agent.service';
import { TablePropertiesService } from './table-properties.service';
import { TableRowsService } from './table-rows.service';
import { TablesService } from './tables.service';

export { parseNumericLoose } from './_num.util';

@Injectable()
export class TableImportService {
  private readonly logger = new Logger(TableImportService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TablesService) private readonly tables: TablesService,
    @Inject(TablePropertiesService)
    private readonly properties: TablePropertiesService,
    @Inject(TableRowsService) private readonly rows: TableRowsService,
    @Inject(TableAgentService) private readonly agent: TableAgentService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async commitCreate(args: {
    tenantId: string;
    userId: string;
    schema: InferredTableSchema;
    rows: string[][];
  }): Promise<{ tableId: string; rowsCreated: number; entitiesLinked: number }> {
    const { tenantId, userId, schema } = args;

    const table = await this.tables.create({
      tenantId,
      userId,
      input: {
        name: schema.name,
        ...(schema.description != null ? { description: schema.description } : {}),
        ...(schema.icon != null ? { icon: schema.icon } : {}),
        ...(schema.entitySync
          ? { entitySync: { type: schema.entitySync.type, autoCreate: false } }
          : {}),
      },
    });

    await this.properties.createMany({
      tenantId,
      tableId: table.id,
      properties: schema.properties.map((p) => ({
        name: p.name,
        type: p.type,
        isPrimary: p.isPrimary,
        ...(p.config ? { config: p.config } : {}),
      })),
    });

    const created = await this.properties.list({ tenantId, tableId: table.id });
    const ordered = [...created].sort(
      (a, b) => Number(a.order.toString()) - Number(b.order.toString()),
    );
    const propIdByIndex = schema.properties.map((_p, j) => ordered[j]?.id ?? null);
    const primaryIndex = schema.properties.findIndex((p) => p.isPrimary);

    return this.materializeRows({
      tenantId,
      userId,
      tableId: table.id,
      schema,
      rows: args.rows,
      propIdByIndex,
      primaryIndex,
    });
  }

  async commitMerge(args: {
    tenantId: string;
    userId: string;
    targetTableId: string;
    schema: InferredTableSchema;
    rows: string[][];
  }): Promise<{ tableId: string; rowsCreated: number; entitiesLinked: number }> {
    const { tenantId, userId, targetTableId, schema } = args;

    const target = await this.tables.findById({ tenantId, id: targetTableId });
    const targetProps = await this.properties.list({
      tenantId,
      tableId: target.id,
    });
    if (targetProps.length === 0) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'target_table_no_columns',
          message: 'В целевой таблице нет колонок — слияние невозможно.',
        },
      });
    }

    const byName = new Map<string, (typeof targetProps)[number]>();
    for (const p of targetProps) byName.set(this.norm(p.name), p);
    const usedPropIds = new Set<string>();
    const propIdByIndex = schema.properties.map((p) => {
      const match = byName.get(this.norm(p.name));
      if (!match) return null;
      if (usedPropIds.has(match.id)) {
        this.logger.warn(
          { tableId: target.id, column: p.name, propertyId: match.id },
          'table-import: неоднозначный маппинг колонки — пропущена (дубль имени)',
        );
        return null;
      }
      usedPropIds.add(match.id);
      return match.id;
    });

    const primaryIndex = schema.properties.findIndex((p) => p.isPrimary);
    const targetSync = parseEntitySync(target.entitySync);
    const schemaForLink: InferredTableSchema = {
      ...schema,
      entitySync: targetSync?.type ? { type: targetSync.type } : null,
    };

    return this.materializeRows({
      tenantId,
      userId,
      tableId: target.id,
      schema: schemaForLink,
      rows: args.rows,
      propIdByIndex,
      primaryIndex,
    });
  }

  private async materializeRows(args: {
    tenantId: string;
    userId: string;
    tableId: string;
    schema: InferredTableSchema;
    rows: string[][];
    propIdByIndex: Array<string | null>;
    primaryIndex: number;
  }): Promise<{ tableId: string; rowsCreated: number; entitiesLinked: number }> {
    const { tenantId, userId, tableId, schema, rows, propIdByIndex, primaryIndex } = args;

    const limit = this.cfg.smartTables.maxRowsPerTable;
    const current = await this.prisma.tableRow.count({
      where: { tableId, deletedAt: null, archivedAt: null },
    });
    if (current + rows.length > limit) {
      throw new UnprocessableEntityException({
        ok: false,
        error: {
          code: 'table_rows_limit_exceeded',
          message: `Импорт превысит лимит строк в таблице: уже есть ${current}, импортируется ${rows.length}, лимит ${limit}. Уменьшите файл или напишите в поддержку.`,
        },
      });
    }

    const primaryValues = rows.map((r) => (primaryIndex >= 0 ? (r[primaryIndex] ?? null) : null));
    const { entityIds, linkedCount } = await this.agent.linkRowsToEntities({
      tenantId,
      entitySync: schema.entitySync,
      primaryValues,
    });

    const payload = rows.map((row, i) => {
      const cells: Record<string, unknown> = {};
      for (let j = 0; j < propIdByIndex.length; j++) {
        const propId = propIdByIndex[j];
        if (!propId) continue;
        const raw = row[j];
        if (raw === undefined || raw === '') continue;
        const type = schema.properties[j]?.type ?? 'text';
        cells[propId] = this.coerce(raw, type);
      }
      const entityId = entityIds[i] ?? null;
      return entityId ? { cells, entityId } : { cells };
    });

    const res = await this.rows.createMany({
      tenantId,
      tableId,
      userId,
      rows: payload,
    });

    this.logger.log(
      { tableId, rowsCreated: res.created, entitiesLinked: linkedCount },
      'table-import: строки перенесены',
    );
    return { tableId, rowsCreated: res.created, entitiesLinked: linkedCount };
  }

  private coerce(raw: string, type: string): unknown {
    const v = raw.trim();
    switch (type) {
      case 'number':
      case 'currency':
      case 'percent': {
        const n = parseNumericLoose(v);
        return n === null ? v : n;
      }
      case 'checkbox': {
        const low = v.toLowerCase();
        if (['да', 'true', '1', 'yes', '✓', 'x', 'есть'].includes(low)) return true;
        if (['нет', 'false', '0', 'no', '', '-'].includes(low)) return false;
        return v;
      }
      default:
        return v;
    }
  }

  private norm(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
