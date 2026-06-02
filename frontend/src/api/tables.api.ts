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
import { ApiError } from './api-error';
import { buildQuery, orgHeaders } from './admin-helpers';
import type {
  ImportAnalyzeResult,
  InferredTableSchema,
  TableFilterCondition,
} from '@/domain/table';
import type {
  CellProvenanceApi,
  CreatePropertyBodyApi,
  CreateRowBodyApi,
  CreateTableBodyApi,
  CreateTableViewBodyApi,
  PendingPatchApi,
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

/**
 * Multipart-загрузка файла на анализ схемы (Smart-tables Фаза 4). apiClient
 * умеет только JSON, поэтому делаем raw `fetch` с FormData (поле `file`),
 * сохраняя cookie-сессию и заголовок X-Org-Id. Паттерн повторяет
 * `documentsApi.upload`.
 */
async function importAnalyzeMultipart(
  orgId: string,
  file: File,
): Promise<ImportAnalyzeResult> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/tables/import/analyze`;
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Org-Id': orgId },
    body: form,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {
      // тело не JSON — оставляем дефолтные code/message
    }
    throw new ApiError({ code, message });
  }
  return (await res.json()) as ImportAnalyzeResult;
}

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

  /**
   * Smart-tables auto-creation (Фаза 4) — анализ загруженного файла
   * (Excel/CSV). multipart, поле `file`. Идём не через apiClient (он
   * JSON-only), но соблюдаем те же headers (X-Org-Id) и cookie-сессию —
   * паттерн как у `documentsApi.upload`.
   * `POST /api/v1/tables/import/analyze`.
   */
  importAnalyze: (orgId: string, file: File) =>
    importAnalyzeMultipart(orgId, file),

  /**
   * Smart-tables auto-creation (Фаза 4) — создать новую таблицу или слить
   * со существующей по результату анализа. `schema` и `rows` берутся из
   * ответа `importAnalyze` без изменений.
   * `POST /api/v1/tables/import/commit`.
   */
  importCommit: (
    orgId: string,
    body: {
      mode: 'create' | 'merge';
      targetTableId?: string;
      schema: InferredTableSchema;
      rows: string[][];
    },
  ) =>
    apiClient.post<{
      tableId: string;
      rowsCreated: number;
      entitiesLinked: number;
    }>(`/api/v1/tables/import/commit`, body, {
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

  /**
   * NL Saved Views (Фаза 5) — конвертирует естественно-языковой запрос
   * пользователя в JSON-фильтр таблицы. Backend прогоняет запрос через LLM,
   * валидирует условия против реальной схемы колонок и кэширует результат в
   * Redis (`cached: true` — попадание в кэш).
   *
   * `POST /api/v1/tables/:tableId/semantic-filter` body `{ nlQuery }`.
   * Контракт — `backend/src/modules/tables/dto/tables.dto.ts`
   * (`SemanticFilterResultDto`). Фронт применяет `filters` к строкам
   * клиент-сайд (см. `applyFilters` в `domain/table.ts`).
   */
  semanticFilter: (orgId: string, tableId: string, nlQuery: string) =>
    apiClient.post<{ filters: TableFilterCondition[]; cached: boolean }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/semantic-filter`,
      { nlQuery },
      { headers: orgHeaders(orgId) },
    ),
};

/**
 * Provenance (audit-link) + очередь подтверждений правок — Фаза 3
 * smart-tables (Event-to-Cells).
 *
 *   GET  /api/v1/tables/rows/:rowId/provenance        → { items: CellProvenanceApi[] }
 *   POST /api/v1/tables/cell-provenance/:id/undo      → { rolledBack: boolean }
 *   GET  /api/v1/tables/pending-patches?tableId=      → { items: PendingPatchApi[] }
 *   POST /api/v1/tables/pending-patches/:id/decide    → { status: string }
 *
 * Все за CookieAuthGuard + TenantGuard (заголовок `X-Org-Id`).
 * Контракт backend — `backend/src/modules/tables/controllers/pending-patches.controller.ts`.
 */
export const tableProvenanceApi = {
  /** Провенансы значений ячеек строки (источники авто-правок). */
  getRowProvenance: (orgId: string, rowId: string) =>
    apiClient.get<{ items: CellProvenanceApi[] }>(
      `/api/v1/tables/rows/${encodeURIComponent(rowId)}/provenance`,
      { headers: orgHeaders(orgId) },
    ),

  /** Откатить авто-правку ячейки (восстановить previousValue). */
  undoCellProvenance: (orgId: string, provenanceId: string) =>
    apiClient.post<{ rolledBack: boolean }>(
      `/api/v1/tables/cell-provenance/${encodeURIComponent(provenanceId)}/undo`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  /** Список правок ячеек на подтверждении (опц. фильтр по таблице). */
  listPendingPatches: (orgId: string, tableId: string) =>
    apiClient.get<{ items: PendingPatchApi[] }>(
      `/api/v1/tables/pending-patches${buildQuery({ tableId })}`,
      { headers: orgHeaders(orgId) },
    ),

  /** Подтвердить или отклонить правку ячейки. */
  decidePendingPatch: (
    orgId: string,
    patchId: string,
    decision: 'approve' | 'reject',
  ) =>
    apiClient.post<{ status: string }>(
      `/api/v1/tables/pending-patches/${encodeURIComponent(patchId)}/decide`,
      { decision },
      { headers: orgHeaders(orgId) },
    ),
};
