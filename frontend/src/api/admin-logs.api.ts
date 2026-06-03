/**
 * API-клиент технических логов (LoggingModule).
 *
 * Контракт: backend `SystemLogsController` под `/api/v1/platform/logs`.
 * Защита — SuperAdminGuard. См. plans/tz/2026-06-01-logging-module.md §13.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  LogCleanupResultApi,
  LoggingSettingsApi,
  SystemLogAggregatesApi,
  SystemLogChainApi,
  SystemLogListApi,
  SystemLogRecordApi,
} from '@/domain/system-logs';

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
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
  search?: string;
  limit?: number;
  offset?: number;
};

export type AggregatesQuery = {
  dateFrom?: string; // ISO
  dateTo?: string; // ISO
};

const BASE = '/api/v1/platform/logs';

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
