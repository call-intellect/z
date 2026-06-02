import type {
  Table,
  TablePropType,
  TableProperty,
  TableRow,
  TableView,
  TableViewType,
  TableViewVisibility,
} from '@prisma/client';
import { z } from 'zod';

import type { TableFilterCondition } from './table-filter.dto';

/**
 * Zod-схемы и DTO для Smart Tables (Фаза 0 — каркас CRUD).
 *
 * См. plans/tz/2026-05-31-smart-tables.md §Фаза 0.
 *
 * NB: Views / Automations / AI — отдельные фазы, в этом файле НЕТ.
 */

// ─────────────────────────── Table ───────────────────────────────────────

/**
 * Полный список значений `EntityType` (см. enum в schema.prisma). Используется
 * для точного фильтра `entitySync.entityTypes`. Держим как явный z.enum, чтобы
 * не зависеть от рантайм-импорта enum'а из @prisma/client (он не существует как
 * значение — только как тип).
 */
export const EntityTypeSchema = z.enum([
  'client',
  'person',
  'customer',
  'vendor',
  'project',
  'product',
  'document',
  'goal',
  'event',
  'topic',
  'location',
  'technology',
  'metric',
  'market',
  'org_unit',
  'custom',
]);
export type EntityTypeValue = z.infer<typeof EntityTypeSchema>;

/**
 * Полный список валидных значений `entitySync.type` — соответствует
 * полю `entitySync` в `Table` (см. schema.prisma §Smart Tables).
 *
 * Smart-tables Фаза 2 (graph-driven rows): `entityTypes` — точный фильтр
 * классов Entity для живого синка строк. `type` остаётся грубой категорией
 * (org/person/meeting/document); если `entityTypes` не задан — резолвер
 * выводит дефолт по `type` (см. `resolveEntityTypes`).
 */
export const TableEntitySyncSchema = z.object({
  type: z.enum(['org', 'person', 'meeting', 'document']),
  autoCreate: z.boolean(),
  /** id колонки, по которой ищем дубликаты при autoCreate. */
  primaryProperty: z.string().min(1).max(100).optional(),
  /** Точный фильтр классов Entity для синка (Фаза 2). Если пуст — дефолт по `type`. */
  entityTypes: z.array(EntityTypeSchema).optional(),
});
export type TableEntitySync = z.infer<typeof TableEntitySyncSchema>;

export const CreateTableBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional(),
  /** Эмодзи или id icon-set. */
  icon: z.string().trim().max(50).optional(),
  /** Если таблица «живёт внутри» документа — id parent Document. */
  parentDocumentId: z.string().cuid().optional(),
  entitySync: TableEntitySyncSchema.optional(),
});
export type CreateTableBody = z.infer<typeof CreateTableBodySchema>;

export const UpdateTableBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  parentDocumentId: z.string().cuid().nullable().optional(),
  entitySync: TableEntitySyncSchema.nullable().optional(),
});
export type UpdateTableBody = z.infer<typeof UpdateTableBodySchema>;

export const TablesListQuerySchema = z.object({
  archived: z.enum(['all', 'active', 'archived']).default('active'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TablesListQuery = z.infer<typeof TablesListQuerySchema>;

/**
 * Response-DTO. Не возвращаем `deletedAt` (внутреннее поле retention'а).
 */
export interface TableViewDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  icon: string | null;
  coverImageS3: string | null;
  parentDocumentId: string | null;
  entitySync: Record<string, unknown> | null;
  defaultViewId: string | null;
  archivedAt: string | null;
  /** Системная таблица (авто-создана при создании Org). Hard-delete запрещён. */
  isSystem: boolean;
  /** Ключ системного шаблона (clients_deals / team / …) или null. */
  systemKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function toTableViewDto(t: Table): TableViewDto {
  return {
    id: t.id,
    tenantId: t.tenantId,
    name: t.name,
    description: t.description,
    icon: t.icon,
    coverImageS3: t.coverImageS3,
    parentDocumentId: t.parentDocumentId,
    entitySync: (t.entitySync as Record<string, unknown> | null) ?? null,
    defaultViewId: t.defaultViewId,
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
    isSystem: t.isSystem,
    systemKey: t.systemKey,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ─────────────────────── Text-to-Schema (Фаза 1) ─────────────────────────

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema.
 *
 * `POST /tables/infer-schema` — body запроса на генерацию схемы по NL-описанию.
 */
export const InferSchemaBodySchema = z.object({
  /** NL-описание желаемой таблицы. Минимум 3 символа. */
  prompt: z.string().trim().min(3).max(2000),
});
export type InferSchemaBody = z.infer<typeof InferSchemaBodySchema>;

/**
 * Колонка в сгенерированной/создаваемой-из-схемы таблице. `type` ограничен
 * пользовательскими типами (без системных createdAt/createdBy/entityLink/...).
 */
const SchemaPropertyUserTypeSchema = z.enum([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
  'file',
  'formula',
  'relation',
  'rollup',
]);

export const InferredSchemaPropertySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: SchemaPropertyUserTypeSchema,
  isPrimary: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Response-DTO `POST /tables/infer-schema` — превью схемы (без создания).
 * Совпадает по форме с `InferredTableSchema` из TableAgentService.
 */
export interface InferredTableSchemaDto {
  name: string;
  description: string | null;
  icon: string | null;
  entitySync: { type: 'org' | 'person' | 'meeting' | 'document' } | null;
  properties: Array<{
    name: string;
    type: TablePropType;
    isPrimary: boolean;
    config?: Record<string, unknown>;
  }>;
}

/**
 * `POST /tables/from-schema` — создать таблицу из (отредактированной) схемы.
 * Колонки создаются bulk-ом после создания самой таблицы.
 */
export const CreateTableFromSchemaBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  entitySync: z
    .object({ type: z.enum(['org', 'person', 'meeting', 'document']) })
    .nullable()
    .optional(),
  properties: z.array(InferredSchemaPropertySchema).min(1).max(50),
});
export type CreateTableFromSchemaBody = z.infer<
  typeof CreateTableFromSchemaBodySchema
>;

// ─────────────────── Document-to-Table (Фаза 4) ──────────────────────────

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 4) — Document-to-Table.
 *
 * Поток: пользователь грузит Excel/CSV → `POST /tables/import/analyze` парсит
 * файл, инфёрит схему и ищет похожие таблицы для слияния → фронт показывает
 * превью и кандидатов → `POST /tables/import/commit` создаёт таблицу (или
 * сливает строки в существующую).
 *
 * ВАЖНО — формат `rows`. На этапе analyze колонок ещё нет (propertyId не
 * существует, таблица не создана), поэтому `rows` передаются как массив МАССИВОВ
 * строковых значений: `rows[i][j]` — значение j-го столбца в i-й строке, где `j`
 * соответствует `schema.properties[j]` (и заголовку файла j) ПО ПОРЯДКУ. Этот же
 * формат фронт возвращает в commit. Сопоставление столбец↔колонка — строго по
 * индексу j (см. TableAgentService.inferSchemaFromTabular, alignToHeaders).
 */

/**
 * Одна строка импорта — массив строковых значений ЯЧЕЕК по порядку столбцов.
 * `.max(500)` — потолок числа ЯЧЕЕК В СТРОКЕ (защита от аномально широких
 * строк), а НЕ лимит количества строк. Лимит строк — `rows.max(5000)` ниже.
 */
const ImportRowSchema = z.array(z.string()).max(500);

/**
 * Response-DTO `POST /tables/import/analyze` (превью без создания).
 *   - `schema`         — предложенная схема (как InferredTableSchemaDto);
 *   - `rows`           — все строки в пределах лимита импорта (`importMaxRows`,
 *     до commit-потолка 5000), массивы значений по индексу столбца. Фронт шлёт
 *     их в commit без потерь; превью обрезается только для отображения;
 *   - `rawRowsCount`   — сколько строк всего в файле (после лимита парсера);
 *   - `truncated`      — true, если исходных строк больше, чем влезло в `rows`
 *     (т.е. файл длиннее лимита импорта `importMaxRows`);
 *   - `truncatedColumns`— true, если в файле было больше 50 колонок и лишние
 *     столбцы отброшены парсером;
 *   - `mergeCandidates`— похожие существующие таблицы (cosine ≥ порог), топ-3.
 */
export interface ImportAnalyzeDto {
  schema: InferredTableSchemaDto;
  rows: string[][];
  rawRowsCount: number;
  truncated: boolean;
  truncatedColumns: boolean;
  mergeCandidates: Array<{ tableId: string; name: string; cosine: number }>;
}

/**
 * `POST /tables/import/commit` — материализация импорта.
 *   - mode 'create' — создать новую таблицу из `schema` + перенести `rows`.
 *   - mode 'merge'  — добавить `rows` в существующую `targetTableId`
 *     (сопоставление колонок входной схемы и таблицы — по нормализованному имени).
 *
 * `rows` — тот же массив массивов значений по индексу столбца, что в analyze.
 */
export const ImportCommitBodySchema = z
  .object({
    mode: z.enum(['create', 'merge']),
    targetTableId: z.string().cuid().optional(),
    schema: z.object({
      name: z.string().trim().min(1).max(255),
      description: z.string().trim().max(5000).nullable().optional(),
      icon: z.string().trim().max(50).nullable().optional(),
      entitySync: z
        .object({ type: z.enum(['org', 'person', 'meeting', 'document']) })
        .nullable()
        .optional(),
      properties: z.array(InferredSchemaPropertySchema).min(1).max(50),
    }),
    rows: z.array(ImportRowSchema).max(5000),
  })
  .refine((b) => b.mode !== 'merge' || !!b.targetTableId, {
    message: 'Для слияния нужно указать targetTableId',
    path: ['targetTableId'],
  });
export type ImportCommitBody = z.infer<typeof ImportCommitBodySchema>;

/** Response-DTO `POST /tables/import/commit`. */
export interface ImportCommitResultDto {
  tableId: string;
  rowsCreated: number;
  entitiesLinked: number;
}

// ─────────────────────────── TableProperty ───────────────────────────────

/**
 * Полный список значений `TablePropType` — должен совпадать с enum в
 * `backend/prisma/schema.prisma` (§Smart Tables). При расширении enum'а
 * обновляй обе стороны одновременно.
 */
export const TablePropTypeSchema = z.enum([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
  'file',
  'formula',
  'relation',
  'rollup',
  'createdAt',
  'updatedAt',
  'createdBy',
  'entityLink',
  'meetingLink',
  'documentLink',
]) satisfies z.ZodType<TablePropType>;

export const CreatePropertyBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: TablePropTypeSchema,
  /** Тип-специфичный конфиг (currency/options/expression/...). */
  config: z.record(z.string(), z.unknown()).default({}),
  isPrimary: z.boolean().default(false),
  /** Фракционная сортировка. Если не задан — сервис ставит maxOrder+1. */
  order: z.number().optional(),
});
export type CreatePropertyBody = z.infer<typeof CreatePropertyBodySchema>;

export const UpdatePropertyBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isPrimary: z.boolean().optional(),
});
export type UpdatePropertyBody = z.infer<typeof UpdatePropertyBodySchema>;

export const ReorderPropertyBodySchema = z.object({
  order: z.number(),
});
export type ReorderPropertyBody = z.infer<typeof ReorderPropertyBodySchema>;

export interface PropertyViewDto {
  id: string;
  tableId: string;
  name: string;
  type: TablePropType;
  config: Record<string, unknown>;
  isPrimary: boolean;
  /** Decimal сериализуется в number через Number(). Точность сохраняется
   *  для практических диапазонов (фракционная сортировка). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export function toPropertyViewDto(p: TableProperty): PropertyViewDto {
  return {
    id: p.id,
    tableId: p.tableId,
    name: p.name,
    type: p.type,
    config: (p.config as Record<string, unknown>) ?? {},
    isPrimary: p.isPrimary,
    order: Number(p.order.toString()),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─────────────────────────── TableRow ────────────────────────────────────

export const CreateRowBodySchema = z.object({
  /** `{ [propertyId]: value }`. Тип value — любой JSON-serializable. */
  cells: z.record(z.string(), z.unknown()).default({}),
  /** Если у таблицы entitySync — Entity, к которому привязана строка. */
  entityId: z.string().min(1).max(100).optional(),
  order: z.number().optional(),
  /** ProseMirror-документ внутри карточки строки (Фаза 2+). */
  pageContent: z.record(z.string(), z.unknown()).optional(),
});
export type CreateRowBody = z.infer<typeof CreateRowBodySchema>;

export const UpdateRowBodySchema = z.object({
  cells: z.record(z.string(), z.unknown()).optional(),
  entityId: z.string().min(1).max(100).nullable().optional(),
  order: z.number().optional(),
  pageContent: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type UpdateRowBody = z.infer<typeof UpdateRowBodySchema>;

export const RowsListQuerySchema = z.object({
  archived: z.enum(['all', 'active', 'archived']).default('active'),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RowsListQuery = z.infer<typeof RowsListQuerySchema>;

export interface RowViewDto {
  id: string;
  tableId: string;
  tenantId: string;
  cells: Record<string, unknown>;
  entityId: string | null;
  order: number;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  pageContent: Record<string, unknown> | null;
}

export function toRowViewDto(r: TableRow): RowViewDto {
  return {
    id: r.id,
    tableId: r.tableId,
    tenantId: r.tenantId,
    cells: (r.cells as Record<string, unknown>) ?? {},
    entityId: r.entityId,
    order: Number(r.order.toString()),
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    pageContent: (r.pageContent as Record<string, unknown> | null) ?? null,
  };
}

// ─────────────────────────── TableView ───────────────────────────────────

/**
 * Сохраняемые срезы (Saved Views) — Фаза 3 smart-tables.
 *
 * Полный список `TableViewType` — должен совпадать с enum'ом в
 * `backend/prisma/schema.prisma`. В Фазе 3 реально рендерится только `grid`;
 * остальные типы принимаются в БД (форвард-совместимость), но Grid view
 * рисуется в любом случае.
 */
export const TableViewTypeSchema = z.enum([
  'grid',
  'kanban',
  'calendar',
  'gantt',
  'gallery',
  'timeline',
  'map',
  'form',
  'chart',
]) satisfies z.ZodType<TableViewType>;

export const TableViewVisibilitySchema = z.enum([
  'personal',
  'shared',
  'public',
]) satisfies z.ZodType<TableViewVisibility>;

/**
 * `config` — UI-специфичный JSON. На уровне API валидируем только верхний
 * уровень (record). Семантика полей (filters/sorts/groupBy/hiddenProps/
 * propOrder/rowHeight) проверяется в Domain-слое фронта.
 */
export const CreateTableViewBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: TableViewTypeSchema.default('grid'),
  config: z.record(z.string(), z.unknown()).default({}),
  visibility: TableViewVisibilitySchema.default('personal'),
});
export type CreateTableViewBody = z.infer<typeof CreateTableViewBodySchema>;

export const UpdateTableViewBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: TableViewTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  visibility: TableViewVisibilitySchema.optional(),
});
export type UpdateTableViewBody = z.infer<typeof UpdateTableViewBodySchema>;

export interface TableViewViewDto {
  id: string;
  tableId: string;
  name: string;
  type: TableViewType;
  config: Record<string, unknown>;
  visibility: TableViewVisibility;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export function toTableViewViewDto(v: TableView): TableViewViewDto {
  return {
    id: v.id,
    tableId: v.tableId,
    name: v.name,
    type: v.type,
    config: (v.config as Record<string, unknown>) ?? {},
    visibility: v.visibility,
    ownerId: v.ownerId,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

// ─────────────── NL Saved Views — semantic-filter (Фаза 5) ─────────────────

/**
 * Тело запроса `POST /api/v1/tables/:tableId/semantic-filter`: NL-запрос
 * пользователя («покажи клиентов, кому месяц никто не писал»). Минимум 2 символа
 * — иначе LLM нечего конвертировать.
 */
export const SemanticFilterBodySchema = z.object({
  nlQuery: z.string().trim().min(2).max(500),
});
export type SemanticFilterBody = z.infer<typeof SemanticFilterBodySchema>;

/**
 * Ответ semantic-filter: очищенный (валидированный против схемы) набор условий
 * фильтра + флаг `cached` (попадание в Redis-кэш по нормализованному запросу).
 * Тип `TableFilterCondition` — в `table-filter.dto.ts`.
 */
export interface SemanticFilterResultDto {
  filters: TableFilterCondition[];
  cached: boolean;
}

// ─────────────── Pending-patches / provenance (Фаза 3) ────────────────────

/** Query: список pending-патчей (опц. фильтр по tableId). */
export const PendingPatchesListQuerySchema = z.object({
  tableId: z.string().trim().min(1).optional(),
});
export type PendingPatchesListQuery = z.infer<
  typeof PendingPatchesListQuerySchema
>;

/** Body: решение по pending-патчу. */
export const DecidePendingPatchBodySchema = z.object({
  decision: z.enum(['approve', 'reject']),
});
export type DecidePendingPatchBody = z.infer<
  typeof DecidePendingPatchBodySchema
>;

/** DTO одного pending-патча (для очереди подтверждений во фронте). */
export interface PendingPatchDto {
  id: string;
  tableId: string;
  tableRowId: string;
  propertyId: string;
  proposedValue: unknown;
  currentValue: unknown;
  confidence: number;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceLink: string | null;
  reason: string | null;
  createdAt: string;
}

/** DTO одной записи провенанса ячейки (для иконок 🔗 и тултипов). */
export interface CellProvenanceDto {
  id: string;
  propertyId: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  sourceLink: string | null;
  appliedValue: unknown;
  previousValue: unknown;
  confidence: number | null;
  appliedAt: string;
  appliedBy: string;
  rolledBackAt: string | null;
}
