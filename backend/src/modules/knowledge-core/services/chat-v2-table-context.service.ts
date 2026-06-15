import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TableSemanticFilterService } from '../../tables/services/table-semantic-filter.service';

/**
 * ChatV2TableContextService — ЧАСТЬ B ТЗ 2026-06-15 §7.
 *
 * Таблицы как ПАРАЛЛЕЛЬНЫЙ источник chat_v2: при ответе AI-чат ищет не только в
 * графе знаний, но и в умных таблицах компании — на ОБОГАЩЁННОМ понимании
 * запроса (3 формулировки + план: entityHints/aggregation/entityIds).
 *
 * Два пути (оба дешёвые, без доп. LLM-вызова на выбор таблицы в v1):
 *   (а) entity-bridge — если граф уже резолвил сущности (`entityIds`), берём
 *       строки таблиц, привязанные к ним по `TableRow.entityId` (почти бесплатно,
 *       точно: «что по Заречному»).
 *   (б) выбор таблицы по ключевым словам — матчим запрос/entityHints против
 *       `Table.name` + `Table.description` + имён колонок (`TableProperty.name`),
 *       берём топ-N релевантных таблиц; на каждой `parseSemanticFilter` →
 *       conditions → `applyFilterToRows` (server-side, ТЗ §7 шаг 3).
 *
 * Результат — короткие человекочитаемые строки `{ tableName, cells }` для блока
 * «Данные из таблиц» в контексте синтезатора (buildUserMessage, ЧАСТЬ A).
 *
 * Отказоустойчивость (R-INV): любой сбой → `[]`. Падение табличной ветки НЕ
 * валит графовый ответ (ChatV2Service.ask запускает ветку через allSettled).
 *
 * TableSemanticFilterService инжектится `@Optional()`: TablesModule подключён в
 * KnowledgeCoreModule, но в worker-процессе / частичной сборке сервис может быть
 * недоступен — тогда ветка просто возвращает `[]` (граф отвечает как раньше).
 */

export interface FetchTableContextInput {
  tenantId: string;
  /** Обогащённые формулировки (multi-query) + оригинал. Хотя бы одна. */
  queries: string[];
  /** Резолвнутые сущности графа (для entity-bridge). */
  entityIds: string[];
  /** Имена-подсказки (клиенты/проекты/темы) для выбора таблицы по ключевым словам. */
  entityHints: string[];
  /** true — счётный/агрегирующий вопрос («сколько…»): поднимаем cap строк. */
  aggregation: boolean;
}

export interface TableContextRow {
  tableName: string;
  /** Человекочитаемо: «<колонка>=<значение>; …». */
  cells: string;
}

/** Внутреннее представление колонки таблицы. */
interface PropInfo {
  id: string;
  name: string;
}

@Injectable()
export class ChatV2TableContextService {
  private readonly logger = new Logger(ChatV2TableContextService.name);

  /** Cap строк рендерим компактно — не раздуваем длину одной строки контекста. */
  private static readonly CELLS_RENDER_MAX_PROPS = 12;
  private static readonly CELL_VALUE_MAX_LEN = 120;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(TableSemanticFilterService)
    private readonly semanticFilter?: TableSemanticFilterService,
  ) {}

  /**
   * Главный метод. Возвращает строки умных таблиц для контекста синтезатора.
   * Никогда не бросает — при любом сбое `[]`.
   */
  async fetchTableContext(
    input: FetchTableContextInput,
  ): Promise<TableContextRow[]> {
    try {
      const maxRows = await this.resolveMaxRows(input.aggregation);
      const maxTables = await this.resolveMaxTables();
      if (maxRows <= 0) return [];

      const out: TableContextRow[] = [];
      const seenRowKeys = new Set<string>();

      // (а) entity-bridge — почти бесплатный точный путь.
      if (input.entityIds.length > 0) {
        const bridged = await this.fetchByEntityBridge(
          input.tenantId,
          input.entityIds,
          maxRows,
        );
        for (const r of bridged) {
          if (out.length >= maxRows) break;
          if (seenRowKeys.has(r.key)) continue;
          seenRowKeys.add(r.key);
          out.push({ tableName: r.tableName, cells: r.cells });
        }
      }

      // (б) выбор таблицы по ключевым словам + server-side фильтр.
      if (out.length < maxRows && this.semanticFilter) {
        const byKeyword = await this.fetchByKeywordTables(
          input,
          maxTables,
          maxRows - out.length,
        );
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

  // ─────────────────────────── entity-bridge ───────────────────────────

  /**
   * (а) Строки таблиц, привязанные к резолвнутым сущностям графа по
   * `TableRow.entityId`. Берём только живые строки из живых таблиц тенанта.
   */
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

    // Колонки задействованных таблиц — для человекочитаемого рендера.
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

  // ─────────────────────── выбор таблицы по словам ──────────────────────

  /**
   * (б) Подбор релевантных таблиц по ключевым словам (БЕЗ доп. LLM-вызова): матч
   * объединённого запроса/entityHints против Table.name + description + имён
   * колонок. Для топ-N таблиц: parseSemanticFilter → applyFilterToRows.
   */
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
      // Защита от тенанта с сотнями таблиц — берём первую сотню, ранжируем в TS.
      take: 100,
    });
    if (tables.length === 0) return [];

    // Токены запроса: объединённый текст формулировок + подсказки сущностей.
    const queryTokens = this.tokenize(
      [...input.queries, ...input.entityHints].join(' '),
    );
    if (queryTokens.size === 0) return [];

    // Скоринг таблиц по пересечению токенов с name/description/именами колонок.
    const scored = tables
      .map((t) => {
        const haystack = this.tokenize(
          [t.name, t.description ?? '', ...t.properties.map((p) => p.name)].join(
            ' ',
          ),
        );
        let score = 0;
        for (const tok of queryTokens) if (haystack.has(tok)) score++;
        return { table: t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTables);
    if (scored.length === 0) return [];

    // Объединённый обогащённый вопрос для табличного фильтра (фильтр считает
    // против реальных колонок ЭТОЙ таблицы — см. ТЗ §7 шаг 2).
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
        // Парс-фильтр / applyFilter упал на ОДНОЙ таблице — пропускаем её,
        // остальные считаем (ветка не валится целиком).
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

  // ─────────────────────────── helpers ───────────────────────────

  /** Колонки (id+name) по списку tableId — для рендера ячеек человекочитаемо. */
  private async loadPropsByTable(
    tableIds: string[],
  ): Promise<Map<string, PropInfo[]>> {
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

  /**
   * Рендерит cells (`{propertyId: value}`) в строку «<колонка>=<значение>; …».
   * Имена колонок берём из TableProperty.name по propertyId; пустые значения и
   * неизвестные колонки пропускаем; длинные значения обрезаем.
   */
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
    // Колонки, которых нет в props (legacy/мусор), но есть в cells — пропускаем
    // (без имени их рендерить бессмысленно). nameById оставлен для будущего.
    void nameById;
    return parts.join('; ');
  }

  /** Значение ячейки → короткий текст; пусто/объект → null (не рендерим). */
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

  /** Безопасное приведение JSONB cells к объекту. */
  private asCells(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  /**
   * Токенизация для keyword-матча: lower + только слова (буквы/цифры, рус+лат),
   * длиной ≥3 (отсекаем предлоги). Возвращает Set уникальных токенов.
   */
  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
    if (!matches) return tokens;
    for (const m of matches) {
      if (m.length >= 3) tokens.add(m);
    }
    return tokens;
  }

  /** Cap строк (крутилка `chat_v2.table_context_max_rows`, дефолт 20). При
   *  aggregation=true поднимаем cap до 2× (счётный вопрос — считаем по строкам). */
  private async resolveMaxRows(aggregation: boolean): Promise<number> {
    const base = await this.cfg.getDynamic<number>(
      'chat_v2.table_context_max_rows',
      undefined,
      20,
    );
    const safe = Number.isFinite(base) && base > 0 ? Math.floor(base) : 20;
    return aggregation ? safe * 2 : safe;
  }

  /** Cap таблиц (крутилка `chat_v2.table_context_max_tables`, дефолт 2). */
  private async resolveMaxTables(): Promise<number> {
    const base = await this.cfg.getDynamic<number>(
      'chat_v2.table_context_max_tables',
      undefined,
      2,
    );
    return Number.isFinite(base) && base > 0 ? Math.floor(base) : 2;
  }
}
