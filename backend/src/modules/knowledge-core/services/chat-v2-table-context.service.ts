import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TableSemanticFilterService } from '../../tables/services/table-semantic-filter.service';

export interface FetchTableContextInput {
  tenantId: string;
  queries: string[];
  entityIds: string[];
  entityHints: string[];
  aggregation: boolean;
}

export interface TableContextRow {
  tableName: string;
  cells: string;
}

interface PropInfo {
  id: string;
  name: string;
}

@Injectable()
export class ChatV2TableContextService {
  private readonly logger = new Logger(ChatV2TableContextService.name);

  private static readonly CELLS_RENDER_MAX_PROPS = 12;
  private static readonly CELL_VALUE_MAX_LEN = 120;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(TableSemanticFilterService)
    private readonly semanticFilter?: TableSemanticFilterService,
  ) {}

  async fetchTableContext(input: FetchTableContextInput): Promise<TableContextRow[]> {
    try {
      const maxRows = await this.resolveMaxRows(input.aggregation);
      const maxTables = await this.resolveMaxTables();
      if (maxRows <= 0) return [];

      const out: TableContextRow[] = [];
      const seenRowKeys = new Set<string>();

      if (input.entityIds.length > 0) {
        const bridged = await this.fetchByEntityBridge(input.tenantId, input.entityIds, maxRows);
        for (const r of bridged) {
          if (out.length >= maxRows) break;
          if (seenRowKeys.has(r.key)) continue;
          seenRowKeys.add(r.key);
          out.push({ tableName: r.tableName, cells: r.cells });
        }
      }

      if (out.length < maxRows && this.semanticFilter) {
        const byKeyword = await this.fetchByKeywordTables(input, maxTables, maxRows - out.length);
        for (const r of byKeyword) {
          if (out.length >= maxRows) break;
          if (seenRowKeys.has(r.key)) continue;
          seenRowKeys.add(r.key);
          out.push({ tableName: r.tableName, cells: r.cells });
        }
      }

      return out;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: input.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'chat-v2 fetchTableContext: сбой — возвращаем [] (граф отвечает)',
      );
      return [];
    }
  }

  private async fetchByEntityBridge(
    tenantId: string,
    entityIds: string[],
    limit: number,
  ): Promise<Array<{ key: string; tableName: string; cells: string }>> {
    const rows = await this.prisma.tableRow.findMany({
      where: {
        tenantId,
        entityId: { in: entityIds },
        archivedAt: null,
        deletedAt: null,
        table: { archivedAt: null, deletedAt: null },
      },
      select: {
        id: true,
        cells: true,
        tableId: true,
        table: { select: { name: true } },
      },
      take: limit,
    });
    if (rows.length === 0) return [];

    const tableIds = [...new Set(rows.map((r) => r.tableId))];
    const propsByTable = await this.loadPropsByTable(tableIds);

    const out: Array<{ key: string; tableName: string; cells: string }> = [];
    for (const row of rows) {
      const props = propsByTable.get(row.tableId) ?? [];
      out.push({
        key: row.id,
        tableName: row.table?.name ?? '—',
        cells: this.renderCells(row.cells, props),
      });
    }
    return out;
  }

  private async fetchByKeywordTables(
    input: FetchTableContextInput,
    maxTables: number,
    remainingRows: number,
  ): Promise<Array<{ key: string; tableName: string; cells: string }>> {
    if (!this.semanticFilter || remainingRows <= 0 || maxTables <= 0) return [];

    const tables = await this.prisma.table.findMany({
      where: { tenantId: input.tenantId, archivedAt: null, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        properties: { select: { id: true, name: true } },
      },
      take: 100,
    });
    if (tables.length === 0) return [];

    const queryTokens = this.tokenize([...input.queries, ...input.entityHints].join(' '));
    if (queryTokens.size === 0) return [];

    const scored = tables
      .map((t) => {
        const haystack = this.tokenize(
          [t.name, t.description ?? '', ...t.properties.map((p) => p.name)].join(' '),
        );
        let score = 0;
        for (const tok of queryTokens) if (haystack.has(tok)) score++;
        return { table: t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTables);
    if (scored.length === 0) return [];

    const nlQuery = input.queries.join(' ');

    const out: Array<{ key: string; tableName: string; cells: string }> = [];
    for (const { table } of scored) {
      if (out.length >= remainingRows) break;
      try {
        const parsed = await this.semanticFilter.parseSemanticFilter({
          tenantId: input.tenantId,
          tableId: table.id,
          nlQuery,
        });
        const rows = await this.semanticFilter.applyFilterToRows({
          tenantId: input.tenantId,
          tableId: table.id,
          conditions: parsed.filters,
          limit: remainingRows - out.length,
        });
        const props: PropInfo[] = table.properties.map((p) => ({
          id: p.id,
          name: p.name,
        }));
        for (const row of rows) {
          if (out.length >= remainingRows) break;
          out.push({
            key: row.id,
            tableName: table.name,
            cells: this.renderCells(row.cells, props),
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            tableId: table.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'chat-v2 fetchTableContext: таблица пропущена (фильтр упал)',
        );
      }
    }
    return out;
  }

  private async loadPropsByTable(tableIds: string[]): Promise<Map<string, PropInfo[]>> {
    const result = new Map<string, PropInfo[]>();
    if (tableIds.length === 0) return result;
    const props = await this.prisma.tableProperty.findMany({
      where: { tableId: { in: tableIds } },
      select: { id: true, name: true, tableId: true },
      orderBy: { order: 'asc' },
    });
    for (const p of props) {
      const list = result.get(p.tableId) ?? [];
      list.push({ id: p.id, name: p.name });
      result.set(p.tableId, list);
    }
    return result;
  }

  private renderCells(rawCells: unknown, props: PropInfo[]): string {
    const cells = this.asCells(rawCells);
    const nameById = new Map(props.map((p) => [p.id, p.name] as const));
    const parts: string[] = [];
    for (const p of props) {
      if (parts.length >= ChatV2TableContextService.CELLS_RENDER_MAX_PROPS) break;
      const v = cells[p.id];
      const text = this.valueToText(v);
      if (text === null) continue;
      parts.push(`${p.name}=${text}`);
    }
    void nameById;
    return parts.join('; ');
  }

  private valueToText(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    let text: string;
    if (typeof v === 'string') {
      if (v.trim().length === 0) return null;
      text = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      text = String(v);
    } else if (Array.isArray(v)) {
      if (v.length === 0) return null;
      text = v.map((x) => String(x)).join(', ');
    } else {
      return null;
    }
    return text.length > ChatV2TableContextService.CELL_VALUE_MAX_LEN
      ? `${text.slice(0, ChatV2TableContextService.CELL_VALUE_MAX_LEN)}…`
      : text;
  }

  private asCells(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
    if (!matches) return tokens;
    for (const m of matches) {
      if (m.length >= 3) tokens.add(m);
    }
    return tokens;
  }

  private async resolveMaxRows(aggregation: boolean): Promise<number> {
    const base = await this.cfg.getDynamic<number>('chat_v2.table_context_max_rows', undefined, 20);
    const safe = Number.isFinite(base) && base > 0 ? Math.floor(base) : 20;
    return aggregation ? safe * 2 : safe;
  }

  private async resolveMaxTables(): Promise<number> {
    const base = await this.cfg.getDynamic<number>(
      'chat_v2.table_context_max_tables',
      undefined,
      2,
    );
    return Number.isFinite(base) && base > 0 ? Math.floor(base) : 2;
  }
}
