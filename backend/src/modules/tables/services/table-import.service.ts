import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { parseEntitySync } from './entity-sync.util';
import type { InferredTableSchema } from './table-agent.service';
import { TableAgentService } from './table-agent.service';
import { TablePropertiesService } from './table-properties.service';
import { TableRowsService } from './table-rows.service';
import { TablesService } from './tables.service';

/**
 * Устойчивый парс числа из строки файла. Срезает валюту/%/пробелы/буквы,
 * корректно определяет десятичный разделитель:
 *   - «1 234,56»  → 1234.56 (запятая — десятичный, пробел — группировка);
 *   - «1,234.56»  → 1234.56 (точка — десятичный, запятая — группировка);
 *   - «15%»       → 15;   «$1 200» → 1200;   мусор → null (caller вернёт строку).
 *
 * ВНИМАНИЕ: «1,200» (запятая последняя, без точки) фундаментально неоднозначно —
 * трактуется как десятичное 1.2, а НЕ 1200. Однозначное «1200» дают пробел или
 * точка как разделитель групп. Это компромисс парсинга без локали.
 */
export function parseNumericLoose(v: string): number | null {
  const s0 = v.replace(/[^\d.,-]/g, ''); // срезаем валюту/%/пробелы/буквы
  if (!s0) return null;
  const lastComma = s0.lastIndexOf(',');
  const lastDot = s0.lastIndexOf('.');
  let s: string;
  if (lastComma > lastDot) s = s0.replace(/\./g, '').replace(',', '.'); // запятая — десятичный
  else s = s0.replace(/,/g, ''); // точка — десятичный (или нет дробной)
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 4) — Document-to-Table, commit.
 *
 * Материализует разобранный импорт в таблицу:
 *   - create: создаёт таблицу из схемы → колонки → переносит строки → линкует
 *     строки к Entity (если у схемы есть entitySync);
 *   - merge:  сопоставляет столбцы входной схемы с колонками целевой таблицы по
 *     нормализованному имени → переносит строки → линкует к Entity.
 *
 * Формат входных `rows` — массив массивов строковых значений (`rows[i][j]` —
 * значение j-го столбца), где `j` соответствует `schema.properties[j]` по
 * порядку (см. tables.dto.ts §Document-to-Table).
 */
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

  /**
   * mode=create: создать новую таблицу из схемы и перенести строки.
   */
  async commitCreate(args: {
    tenantId: string;
    userId: string;
    schema: InferredTableSchema;
    rows: string[][];
  }): Promise<{ tableId: string; rowsCreated: number; entitiesLinked: number }> {
    const { tenantId, userId, schema } = args;

    // 1. Таблица.
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

    // 2. Колонки (bulk, порядок сохранён).
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

    // 3. Перечитать созданные колонки в порядке создания — нужны их id для cells.
    const created = await this.properties.list({ tenantId, tableId: table.id });
    // createMany гарантирует порядок order=(i+1)*1000 → сортируем по order.
    const ordered = [...created].sort(
      (a, b) => Number(a.order.toString()) - Number(b.order.toString()),
    );
    // Маппинг index столбца файла j → propertyId. Берём первые N созданных
    // колонок (системные авто-колонки, если их добавит провижн, окажутся в конце).
    const propIdByIndex = schema.properties.map(
      (_p, j) => ordered[j]?.id ?? null,
    );
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

  /**
   * mode=merge: добавить строки в существующую таблицу. Колонки входной схемы
   * сопоставляются с колонками целевой таблицы ПО нормализованному имени.
   * Несопоставленные столбцы файла отбрасываются (их данные не переносятся).
   */
  async commitMerge(args: {
    tenantId: string;
    userId: string;
    targetTableId: string;
    schema: InferredTableSchema;
    rows: string[][];
  }): Promise<{ tableId: string; rowsCreated: number; entitiesLinked: number }> {
    const { tenantId, userId, targetTableId, schema } = args;

    // Проверка существования + tenant-scope (бросит 404).
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

    // index столбца файла j → propertyId целевой таблицы (по имени) | null.
    // Защита от дублей имён: если два столбца файла маппятся на ОДИН propertyId,
    // маппим только первый (более ранний). Второй дубль НЕ перетирает первый —
    // ставим null, чтобы его данные не затёрли уже занятую колонку.
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

    // entity-linking при merge: тип берём из entitySync ЦЕЛЕВОЙ таблицы; primary
    // столбец файла = isPrimary из входной схемы.
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

  // ──────────────────────────── private ────────────────────────────────────

  /**
   * Общий перенос строк: собирает cells по propIdByIndex с минимальным
   * приведением типа, линкует к Entity по primary-значению, делает bulk-insert.
   */
  private async materializeRows(args: {
    tenantId: string;
    userId: string;
    tableId: string;
    schema: InferredTableSchema;
    rows: string[][];
    propIdByIndex: Array<string | null>;
    primaryIndex: number;
  }): Promise<{ tableId: string; rowsCreated: number; entitiesLinked: number }> {
    const { tenantId, userId, tableId, schema, rows, propIdByIndex, primaryIndex } =
      args;

    // Анти-обход лимита строк: импорт мог бы влить тысячи строк мимо проверки
    // TableRowsService.create (она по-одной). Считаем активные строки целевой
    // таблицы и не даём суммой превысить maxRowsPerTable. Для create таблица
    // новая → current=0.
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

    // primary-значения для entity-linking (в порядке строк).
    const primaryValues = rows.map((r) =>
      primaryIndex >= 0 ? (r[primaryIndex] ?? null) : null,
    );
    const { entityIds, linkedCount } = await this.agent.linkRowsToEntities({
      tenantId,
      entitySync: schema.entitySync,
      primaryValues,
    });

    // Сборка cells по индексу столбца → propertyId с приведением типа.
    const payload = rows.map((row, i) => {
      const cells: Record<string, unknown> = {};
      for (let j = 0; j < propIdByIndex.length; j++) {
        const propId = propIdByIndex[j];
        if (!propId) continue; // столбец без целевой колонки (merge) — пропуск
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

  /**
   * Минимальное приведение строкового значения файла к типу колонки. Безопасно:
   * при любой неоднозначности оставляем строку (UI отрисует, пользователь
   * поправит). Числа/проценты/деньги → Number (если парсится), checkbox → bool.
   */
  private coerce(raw: string, type: string): unknown {
    const v = raw.trim();
    switch (type) {
      case 'number':
      case 'currency':
      case 'percent': {
        // Устойчивый парс: поддержка «1 234,56», «1,234.56», «15%», «$1,200».
        // percent — число как есть (без деления на 100). Не распарсилось → v.
        const n = parseNumericLoose(v);
        return n === null ? v : n;
      }
      case 'checkbox': {
        const low = v.toLowerCase();
        if (['да', 'true', '1', 'yes', '✓', 'x', 'есть'].includes(low)) return true;
        if (['нет', 'false', '0', 'no', '', '-'].includes(low)) return false;
        // Неизвестное значение НЕ превращаем в Boolean(v) (это давало true почти
        // на всём): возвращаем исходную строку — UI покажет как есть, пользователь
        // поправит вручную.
        return v;
      }
      default:
        return v;
    }
  }

  /** Нормализация имени колонки для матчинга при merge. */
  private norm(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
