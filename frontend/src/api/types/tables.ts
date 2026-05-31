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
