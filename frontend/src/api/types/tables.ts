/**
 * ApiDto-типы Smart Tables (Фаза 1).
 *
 * Контракты backend — `backend/src/modules/tables/dto/tables.dto.ts`.
 * Любая правка enum/полей должна синхронизироваться с backend DTO.
 */

/** Все 24 значения TablePropType из Prisma-схемы. */
export type TablePropTypeApi =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'status'
  | 'selectSingle'
  | 'selectMulti'
  | 'checkbox'
  | 'person'
  | 'url'
  | 'email'
  | 'phone'
  | 'file'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'createdAt'
  | 'updatedAt'
  | 'createdBy'
  | 'entityLink'
  | 'meetingLink'
  | 'documentLink';

export type TableViewTypeApi =
  | 'grid'
  | 'kanban'
  | 'calendar'
  | 'gantt'
  | 'gallery'
  | 'timeline'
  | 'map'
  | 'form'
  | 'chart';

export type TableViewVisibilityApi = 'personal' | 'shared' | 'public';

export interface TableEntitySyncApi {
  type: 'org' | 'person' | 'meeting' | 'document';
  autoCreate: boolean;
  primaryProperty?: string;
}

export interface TableApi {
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

export interface TablePropertyApi {
  id: string;
  tableId: string;
  name: string;
  type: TablePropTypeApi;
  config: Record<string, unknown>;
  isPrimary: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TableRowApi {
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

/** Сохраняемый срез (Saved View) — Фаза 3. */
export interface TableViewApi {
  id: string;
  tableId: string;
  name: string;
  type: TableViewTypeApi;
  config: Record<string, unknown>;
  visibility: TableViewVisibilityApi;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────── Request DTO ─────────────────────────────────

export interface CreateTableBodyApi {
  name: string;
  description?: string;
  icon?: string;
  parentDocumentId?: string;
  entitySync?: TableEntitySyncApi;
}

export interface UpdateTableBodyApi {
  name?: string;
  description?: string | null;
  icon?: string | null;
  parentDocumentId?: string | null;
  entitySync?: TableEntitySyncApi | null;
}

export interface TablesListQueryApi {
  archived?: 'all' | 'active' | 'archived';
  limit?: number;
  offset?: number;
}

export interface CreatePropertyBodyApi {
  name: string;
  type: TablePropTypeApi;
  config?: Record<string, unknown>;
  isPrimary?: boolean;
  order?: number;
}

export interface UpdatePropertyBodyApi {
  name?: string;
  config?: Record<string, unknown>;
  isPrimary?: boolean;
}

export interface ReorderPropertyBodyApi {
  order: number;
}

export interface CreateRowBodyApi {
  cells?: Record<string, unknown>;
  entityId?: string;
  order?: number;
  pageContent?: Record<string, unknown>;
}

export interface UpdateRowBodyApi {
  cells?: Record<string, unknown>;
  entityId?: string | null;
  order?: number;
  pageContent?: Record<string, unknown> | null;
}

export interface RowsListQueryApi {
  archived?: 'all' | 'active' | 'archived';
  limit?: number;
  offset?: number;
}

export interface CreateTableViewBodyApi {
  name: string;
  type?: TableViewTypeApi;
  config?: Record<string, unknown>;
  visibility?: TableViewVisibilityApi;
}

export interface UpdateTableViewBodyApi {
  name?: string;
  type?: TableViewTypeApi;
  config?: Record<string, unknown>;
  visibility?: TableViewVisibilityApi;
}

// ─────────────── Pending-patches / provenance (Фаза 3) ────────────────────
//
// Контракты backend — `backend/src/modules/tables/dto/tables.dto.ts`
// (`CellProvenanceDto`, `PendingPatchDto`, `DecidePendingPatchBody`).

/** Причина, по которой авто-правка попала в очередь подтверждений. */
export type PendingPatchReasonApi = 'low_confidence' | 'overwrite';

/** Одна запись провенанса (происхождения) значения ячейки. */
export interface CellProvenanceApi {
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

/** Одна правка ячейки на подтверждении (очередь подтверждений). */
export interface PendingPatchApi {
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

export interface DecidePendingPatchBodyApi {
  decision: 'approve' | 'reject';
}
