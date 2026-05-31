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

/**
 * Zod-схемы и DTO для Smart Tables (Фаза 0 — каркас CRUD).
 *
 * См. plans/tz/2026-05-31-smart-tables.md §Фаза 0.
 *
 * NB: Views / Automations / AI — отдельные фазы, в этом файле НЕТ.
 */

// ─────────────────────────── Table ───────────────────────────────────────

/**
 * Полный список валидных значений `entitySync.type` — соответствует
 * полю `entitySync` в `Table` (см. schema.prisma §Smart Tables).
 */
export const TableEntitySyncSchema = z.object({
  type: z.enum(['org', 'person', 'meeting', 'document']),
  autoCreate: z.boolean(),
  /** id колонки, по которой ищем дубликаты при autoCreate. */
  primaryProperty: z.string().min(1).max(100).optional(),
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
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
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
