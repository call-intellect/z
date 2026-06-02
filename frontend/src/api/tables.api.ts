/**
 * API-клиент Smart Tables (Фаза 1).
 *
 * Backend контракт — `backend/src/modules/tables/`:
 *
 *   Tables:
 *     POST   /api/v1/tables
 *     GET    /api/v1/tables
 *     GET    /api/v1/tables/:id
 *     PATCH  /api/v1/tables/:id
 *     POST   /api/v1/tables/:id/archive
 *     POST   /api/v1/tables/:id/unarchive
 *     DELETE /api/v1/tables/:id
 *
 *   Properties:
 *     GET    /api/v1/tables/:tableId/properties
 *     POST   /api/v1/tables/:tableId/properties
 *     PATCH  /api/v1/tables/:tableId/properties/:propertyId
 *     POST   /api/v1/tables/:tableId/properties/:propertyId/reorder
 *     DELETE /api/v1/tables/:tableId/properties/:propertyId
 *
 *   Rows:
 *     GET    /api/v1/tables/:tableId/rows
 *     POST   /api/v1/tables/:tableId/rows
 *     GET    /api/v1/tables/:tableId/rows/:rowId
 *     PATCH  /api/v1/tables/:tableId/rows/:rowId
 *     POST   /api/v1/tables/:tableId/rows/:rowId/archive
 *     POST   /api/v1/tables/:tableId/rows/:rowId/unarchive
 *     DELETE /api/v1/tables/:tableId/rows/:rowId
 *
 * Multi-tenancy: все запросы требуют `X-Org-Id` (см. TenantGuard на backend).
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';
import type { InferredTableSchema } from '@/domain/table';
import type {
  CreatePropertyBodyApi,
  CreateRowBodyApi,
  CreateTableBodyApi,
  CreateTableViewBodyApi,
  ReorderPropertyBodyApi,
  RowsListQueryApi,
  TableApi,
  TablePropertyApi,
  TableRowApi,
  TableViewApi,
  TablesListQueryApi,
  UpdatePropertyBodyApi,
  UpdateRowBodyApi,
  UpdateTableBodyApi,
  UpdateTableViewBodyApi,
} from './types/tables';

export const tablesApi = {
  // ─── Tables ───────────────────────────────────────────────────────────
  list: (orgId: string, query: TablesListQueryApi = {}) =>
    apiClient.get<{ items: TableApi[]; total: number }>(
      `/api/v1/tables${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, id: string) =>
    apiClient.get<TableApi>(`/api/v1/tables/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),

  create: (orgId: string, body: CreateTableBodyApi) =>
    apiClient.post<TableApi>(`/api/v1/tables`, body, {
      headers: orgHeaders(orgId),
    }),

  /**
   * Smart-tables Text-to-Schema (Фаза 1) — создать таблицу из
   * (возможно отредактированной) сгенерированной схемы.
   * `POST /api/v1/tables/from-schema` за feature-flag
   * `feature.tables_text_to_schema` (off → 403
   * `feature_tables_text_to_schema_disabled`). Инференс схемы делает
   * Concierge через свой tool — отдельный front-метод не нужен.
   */
  createFromSchema: (orgId: string, body: InferredTableSchema) =>
    apiClient.post<TableApi>(`/api/v1/tables/from-schema`, body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateTableBodyApi) =>
    apiClient.patch<TableApi>(
      `/api/v1/tables/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  archive: (orgId: string, id: string) =>
    apiClient.post<TableApi>(
      `/api/v1/tables/${encodeURIComponent(id)}/archive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  unarchive: (orgId: string, id: string) =>
    apiClient.post<TableApi>(
      `/api/v1/tables/${encodeURIComponent(id)}/unarchive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ id: string }>(`/api/v1/tables/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),

  // ─── Properties ───────────────────────────────────────────────────────
  listProperties: (orgId: string, tableId: string) =>
    apiClient.get<{ items: TablePropertyApi[] }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/properties`,
      { headers: orgHeaders(orgId) },
    ),

  createProperty: (
    orgId: string,
    tableId: string,
    body: CreatePropertyBodyApi,
  ) =>
    apiClient.post<TablePropertyApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/properties`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  updateProperty: (
    orgId: string,
    tableId: string,
    propertyId: string,
    body: UpdatePropertyBodyApi,
  ) =>
    apiClient.patch<TablePropertyApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/properties/${encodeURIComponent(propertyId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  reorderProperty: (
    orgId: string,
    tableId: string,
    propertyId: string,
    body: ReorderPropertyBodyApi,
  ) =>
    apiClient.post<TablePropertyApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/properties/${encodeURIComponent(propertyId)}/reorder`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  deleteProperty: (orgId: string, tableId: string, propertyId: string) =>
    apiClient.del<{ id: string }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/properties/${encodeURIComponent(propertyId)}`,
      { headers: orgHeaders(orgId) },
    ),

  // ─── Rows ─────────────────────────────────────────────────────────────
  listRows: (orgId: string, tableId: string, query: RowsListQueryApi = {}) =>
    apiClient.get<{ items: TableRowApi[]; total: number }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/rows${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  createRow: (orgId: string, tableId: string, body: CreateRowBodyApi) =>
    apiClient.post<TableRowApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/rows`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  updateRow: (
    orgId: string,
    tableId: string,
    rowId: string,
    body: UpdateRowBodyApi,
  ) =>
    apiClient.patch<TableRowApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  archiveRow: (orgId: string, tableId: string, rowId: string) =>
    apiClient.post<TableRowApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}/archive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  deleteRow: (orgId: string, tableId: string, rowId: string) =>
    apiClient.del<{ id: string }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`,
      { headers: orgHeaders(orgId) },
    ),
};

/**
 * Saved Views — Фаза 3 smart-tables.
 *
 *   GET    /api/v1/tables/:tableId/views
 *   POST   /api/v1/tables/:tableId/views
 *   GET    /api/v1/tables/:tableId/views/:viewId
 *   PATCH  /api/v1/tables/:tableId/views/:viewId
 *   DELETE /api/v1/tables/:tableId/views/:viewId
 *
 * Visibility-фильтр на backend: пользователь видит свои personal + все
 * shared/public. Edit/delete — только владелец или admin.
 */
export const tableViewsApi = {
  list: (orgId: string, tableId: string) =>
    apiClient.get<{ items: TableViewApi[] }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/views`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, tableId: string, viewId: string) =>
    apiClient.get<TableViewApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (
    orgId: string,
    tableId: string,
    body: CreateTableViewBodyApi,
  ) =>
    apiClient.post<TableViewApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/views`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (
    orgId: string,
    tableId: string,
    viewId: string,
    body: UpdateTableViewBodyApi,
  ) =>
    apiClient.patch<TableViewApi>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, tableId: string, viewId: string) =>
    apiClient.del<{ id: string }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/views/${encodeURIComponent(viewId)}`,
      { headers: orgHeaders(orgId) },
    ),
};
