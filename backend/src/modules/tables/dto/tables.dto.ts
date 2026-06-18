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

export const TableEntitySyncSchema = z.object({
  type: z.enum(['org', 'person', 'meeting', 'document']),
  autoCreate: z.boolean(),
  primaryProperty: z.string().min(1).max(100).optional(),
  entityTypes: z.array(EntityTypeSchema).optional(),
});

export const CreateTableBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional(),
  icon: z.string().trim().max(50).optional(),
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
  isSystem: boolean;
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

export const InferSchemaBodySchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
});
export type InferSchemaBody = z.infer<typeof InferSchemaBodySchema>;

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
export type CreateTableFromSchemaBody = z.infer<typeof CreateTableFromSchemaBodySchema>;

const ImportRowSchema = z.array(z.string()).max(500);

export interface ImportAnalyzeDto {
  schema: InferredTableSchemaDto;
  rows: string[][];
  rawRowsCount: number;
  truncated: boolean;
  truncatedColumns: boolean;
  mergeCandidates: Array<{ tableId: string; name: string; cosine: number }>;
}

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

export interface ImportCommitResultDto {
  tableId: string;
  rowsCreated: number;
  entitiesLinked: number;
}

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
  config: z.record(z.string(), z.unknown()).default({}),
  isPrimary: z.boolean().default(false),
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

export const CreateRowBodySchema = z.object({
  cells: z.record(z.string(), z.unknown()).default({}),
  entityId: z.string().min(1).max(100).optional(),
  order: z.number().optional(),
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

export const SemanticFilterBodySchema = z.object({
  nlQuery: z.string().trim().min(2).max(500),
});
export type SemanticFilterBody = z.infer<typeof SemanticFilterBodySchema>;

export interface SemanticFilterResultDto {
  filters: TableFilterCondition[];
  cached: boolean;
}

export const PendingPatchesListQuerySchema = z.object({
  tableId: z.string().trim().min(1).optional(),
});
export type PendingPatchesListQuery = z.infer<typeof PendingPatchesListQuerySchema>;

export const DecidePendingPatchBodySchema = z.object({
  decision: z.enum(['approve', 'reject']),
});
export type DecidePendingPatchBody = z.infer<typeof DecidePendingPatchBodySchema>;

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
