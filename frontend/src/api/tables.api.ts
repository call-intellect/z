import { apiClient } from "./api-client";
import { ApiError } from "./api-error";
import { buildQuery, orgHeaders } from "./admin-helpers";
import type {
  ImportAnalyzeResult,
  InferredTableSchema,
  TableFilterCondition,
} from "@/domain/table";
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
} from "./types/tables";

async function importAnalyzeMultipart(
  orgId: string,
  file: File,
): Promise<ImportAnalyzeResult> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/tables/import/analyze`;
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "X-Org-Id": orgId },
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
    } catch {}
    throw new ApiError({ code, message });
  }
  return (await res.json()) as ImportAnalyzeResult;
}

export const tablesApi = {
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

  createFromSchema: (orgId: string, body: InferredTableSchema) =>
    apiClient.post<TableApi>(`/api/v1/tables/from-schema`, body, {
      headers: orgHeaders(orgId),
    }),

  importAnalyze: (orgId: string, file: File) =>
    importAnalyzeMultipart(orgId, file),

  importCommit: (
    orgId: string,
    body: {
      mode: "create" | "merge";
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

  create: (orgId: string, tableId: string, body: CreateTableViewBodyApi) =>
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

  semanticFilter: (orgId: string, tableId: string, nlQuery: string) =>
    apiClient.post<{ filters: TableFilterCondition[]; cached: boolean }>(
      `/api/v1/tables/${encodeURIComponent(tableId)}/semantic-filter`,
      { nlQuery },
      { headers: orgHeaders(orgId) },
    ),
};

export const tableProvenanceApi = {
  getRowProvenance: (orgId: string, rowId: string) =>
    apiClient.get<{ items: CellProvenanceApi[] }>(
      `/api/v1/tables/rows/${encodeURIComponent(rowId)}/provenance`,
      { headers: orgHeaders(orgId) },
    ),

  undoCellProvenance: (orgId: string, provenanceId: string) =>
    apiClient.post<{ rolledBack: boolean }>(
      `/api/v1/tables/cell-provenance/${encodeURIComponent(provenanceId)}/undo`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  listPendingPatches: (orgId: string, tableId: string) =>
    apiClient.get<{ items: PendingPatchApi[] }>(
      `/api/v1/tables/pending-patches${buildQuery({ tableId })}`,
      { headers: orgHeaders(orgId) },
    ),

  decidePendingPatch: (
    orgId: string,
    patchId: string,
    decision: "approve" | "reject",
  ) =>
    apiClient.post<{ status: string }>(
      `/api/v1/tables/pending-patches/${encodeURIComponent(patchId)}/decide`,
      { decision },
      { headers: orgHeaders(orgId) },
    ),
};
