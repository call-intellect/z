import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  LogCleanupResultApi,
  LoggingSettingsApi,
  SystemLogAggregatesApi,
  SystemLogChainApi,
  SystemLogListApi,
  SystemLogRecordApi,
} from "@/domain/system-logs";

export type SystemLogQuery = {
  level?: string;
  levelAtLeast?: string;
  category?: string;
  contour?: string;
  pipeline?: string;
  traceId?: string;
  module?: string;
  userId?: string;
  orgId?: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type AggregatesQuery = {
  dateFrom?: string;
  dateTo?: string;
};

const BASE = "/api/v1/platform/logs";

export const logsApi = {
  list: (params: SystemLogQuery) =>
    apiClient.get<SystemLogListApi>(`${BASE}${buildQuery({ ...params })}`),

  aggregates: (params: AggregatesQuery) =>
    apiClient.get<SystemLogAggregatesApi>(
      `${BASE}/aggregates${buildQuery({ ...params })}`,
    ),

  getOne: (id: string) =>
    apiClient.get<SystemLogRecordApi>(`${BASE}/${encodeURIComponent(id)}`),

  chain: (traceId: string, limit = 500) =>
    apiClient.get<SystemLogChainApi>(
      `${BASE}/chain${buildQuery({ traceId, limit })}`,
    ),

  getSettings: () => apiClient.get<LoggingSettingsApi>(`${BASE}/settings`),

  updateSettings: (patch: Partial<LoggingSettingsApi>) =>
    apiClient.patch<LoggingSettingsApi>(`${BASE}/settings`, patch),

  cleanup: () => apiClient.post<LogCleanupResultApi>(`${BASE}/cleanup`),
};
