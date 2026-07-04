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
  structuralIntent: boolean;
}

export interface TableContextRow {
  tableName: string;
  cells: string;
  sourceObjectType: string | null;
  sourceObjectId: string | null;
}

interface PropInfo {
  id: string;
  name: string;
}

interface ScoredRow {
  key: string;
  tableId: string;
  tableName: string;
  entityId: string | null;
  cells: string;
  relevance: number;
  sourceObjectType: string | null;
  sourceObjectId: string | null;
}

const DEFAULT_GENERIC_STOPWORDS = [
  'что',
  'кто',
  'где',
  'как',
  'какой',
  'какая',
  'какие',
  'какое',
  'сколько',
  'когда',
  'почему',
  'зачем',
  'чей',
  'срок',
  'сроки',
  'статус',
  'описание',
  'дата',
  'даты',
  'владелец',
  'ответственный',
  'тип',
  'имя',
  'название',
  'формулировка',
  'источник',
  'приоритет',
  'значение',
  'комментарий',
  'компания',
  'компании',
  'вопрос',
  'вопросы',
  'данные',
  'информация',
  'задача',
  'задачи',
];

const STEM_MIN_LEN = 4;

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
      const maxRowsPerEntityTable = await this.resolveMaxRowsPerEntityTable();
      if (maxRows <= 0) return [];

      const stopwords = await this.resolveStopwords();
      const queryTokens = this.tokenize([...input.queries, ...input.entityHints].join(' '));

      const out: TableContextRow[] = [];
      const seenRowKeys = new Set<string>();

      const push = (r: ScoredRow): void => {
        if (out.length >= maxRows) return;
        if (seenRowKeys.has(r.key)) return;
        seenRowKeys.add(r.key);
        out.push({
          tableName: r.tableName,
          cells: r.cells,
          sourceObjectType: r.sourceObjectType,
          sourceObjectId: r.sourceObjectId,
        });
      };

      if (input.entityIds.length > 0) {
        const bridged = await this.fetchByEntityBridge(
          input.tenantId,
          input.entityIds,
          maxRows,
          maxRowsPerEntityTable,
          queryTokens,
        );
        for (const r of bridged) push(r);
      }

      if (input.structuralIntent && out.length < maxRows && this.semanticFilter) {
        const byKeyword = await this.fetchByKeywordTables(
          input,
          maxTables,
          maxRows - out.length,
          queryTokens,
          stopwords,
        );
        for (const r of byKeyword) push(r);
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
    maxRowsPerEntityTable: number,
    queryTokens: Set<string>,
  ): Promise<ScoredRow[]> {
    const rows = await this.prisma.tableRow.findMany({
      where: {
        tenantId,
        entityId: { in: entityIds },
        status: 'active',
        archivedAt: null,
        deletedAt: null,
        table: { archivedAt: null, deletedAt: null },
      },
      select: {
        id: true,
        cells: true,
        tableId: true,
        entityId: true,
        sourceObjectType: true,
        sourceObjectId: true,
        table: { select: { name: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: Math.max(limit * 4, limit),
    });
    if (rows.length === 0) return [];

    const tableIds = [...new Set(rows.map((r) => r.tableId))];
    const propsByTable = await this.loadPropsByTable(tableIds);

    const scored: ScoredRow[] = rows.map((row) => {
      const props = propsByTable.get(row.tableId) ?? [];
      const cells = this.renderCells(row.cells, props);
      return {
        key: row.id,
        tableId: row.tableId,
        tableName: row.table?.name ?? '—',
        entityId: row.entityId ?? null,
        cells,
        relevance: this.rowRelevance(cells, queryTokens),
        sourceObjectType: row.sourceObjectType ?? null,
        sourceObjectId: row.sourceObjectId ?? null,
      };
    });

    return this.capPerEntityTable(scored, maxRowsPerEntityTable, limit);
  }

  private async fetchByKeywordTables(
    input: FetchTableContextInput,
    maxTables: number,
    remainingRows: number,
    queryTokens: Set<string>,
    stopwords: Set<string>,
  ): Promise<ScoredRow[]> {
    if (!this.semanticFilter || remainingRows <= 0 || maxTables <= 0) return [];

    const topicalQueryTokens = new Set([...queryTokens].filter((t) => !stopwords.has(t)));
    if (topicalQueryTokens.size === 0) return [];

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

    const scoredTables = tables
      .map((t) => {
        const topicTokens = new Set(
          [...this.tokenize([t.name, t.description ?? ''].join(' '))].filter(
            (tok) => !stopwords.has(tok),
          ),
        );
        let score = 0;
        for (const qt of topicalQueryTokens) {
          if (this.stemMatchesAny(qt, topicTokens)) score++;
        }
        return { table: t, score };
      })
      .filter((s) => s.score >= 1)
      .sort((a, b) => b.score - a.score);

    if (scoredTables.length === 0) return [];
    const selected = scoredTables.slice(0, maxTables);

    const nlQuery = input.queries.join(' ');
    const perTableBudget = Math.max(1, Math.floor(remainingRows / 2));

    const out: ScoredRow[] = [];
    for (const { table } of selected) {
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
          limit: Math.min(perTableBudget, remainingRows - out.length) * 4,
        });
        const props: PropInfo[] = table.properties.map((p) => ({ id: p.id, name: p.name }));
        const scoredRows: ScoredRow[] = rows.map((row) => {
          const cells = this.renderCells(row.cells, props);
          return {
            key: row.id,
            tableId: table.id,
            tableName: table.name,
            entityId: row.entityId,
            cells,
            relevance: this.rowRelevance(cells, topicalQueryTokens),
            sourceObjectType: row.sourceObjectType ?? null,
            sourceObjectId: row.sourceObjectId ?? null,
          };
        });
        scoredRows.sort((a, b) => b.relevance - a.relevance);
        for (const r of scoredRows.slice(0, perTableBudget)) {
          if (out.length >= remainingRows) break;
          out.push(r);
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

  private capPerEntityTable(
    scored: ScoredRow[],
    maxRowsPerEntityTable: number,
    limit: number,
  ): ScoredRow[] {
    const sorted = [...scored].sort((a, b) => b.relevance - a.relevance);
    const perGroup = new Map<string, number>();
    const out: ScoredRow[] = [];
    for (const r of sorted) {
      if (out.length >= limit) break;
      const groupKey = `${r.entityId ?? '∅'}::${r.tableId}`;
      const used = perGroup.get(groupKey) ?? 0;
      if (used >= maxRowsPerEntityTable) continue;
      perGroup.set(groupKey, used + 1);
      out.push(r);
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
    const parts: string[] = [];
    for (const p of props) {
      if (parts.length >= ChatV2TableContextService.CELLS_RENDER_MAX_PROPS) break;
      const v = cells[p.id];
      const text = this.valueToText(v);
      if (text === null) continue;
      parts.push(`${p.name}=${text}`);
    }
    return parts.join('; ');
  }

  private rowRelevance(renderedCells: string, queryTokens: Set<string>): number {
    if (queryTokens.size === 0) return 0;
    const cellTokens = this.tokenize(renderedCells);
    let score = 0;
    for (const qt of queryTokens) {
      if (this.stemMatchesAny(qt, cellTokens)) score++;
    }
    return score;
  }

  private stemMatchesAny(token: string, haystack: Set<string>): boolean {
    if (haystack.has(token)) return true;
    for (const h of haystack) {
      if (this.stemMatch(token, h)) return true;
    }
    return false;
  }

  private stemMatch(a: string, b: string): boolean {
    if (a === b) return true;
    const min = Math.min(a.length, b.length);
    if (min < STEM_MIN_LEN) return false;
    let common = 0;
    while (common < min && a[common] === b[common]) common++;
    return common >= STEM_MIN_LEN;
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
    } else if (typeof v === 'object') {
      const name = (v as Record<string, unknown>)['name'];
      if (typeof name === 'string' && name.trim().length > 0) {
        text = name;
      } else {
        return null;
      }
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
    const base = await this.cfg.getDynamic<number>('chat_v2.table_context_max_rows', undefined, 8);
    const safe = Number.isFinite(base) && base > 0 ? Math.floor(base) : 8;
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

  private async resolveMaxRowsPerEntityTable(): Promise<number> {
    const base = await this.cfg.getDynamic<number>(
      'chat_v2.table_context_max_rows_per_entity_table',
      undefined,
      3,
    );
    return Number.isFinite(base) && base > 0 ? Math.floor(base) : 3;
  }

  private async resolveStopwords(): Promise<Set<string>> {
    const raw = await this.cfg.getDynamic<string[]>(
      'chat_v2.table_generic_stopwords',
      undefined,
      DEFAULT_GENERIC_STOPWORDS,
    );
    const list = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_GENERIC_STOPWORDS;
    return new Set(list.map((s) => String(s).toLowerCase()));
  }
}
