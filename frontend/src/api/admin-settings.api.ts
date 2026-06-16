import { apiClient } from "./api-client";

export type AdminSettingValueApi<T = unknown> = {
  key: string;
  value: T;
  category?: string;
  section?: string;
  severity?: "low" | "medium" | "high" | "destructive";
  description?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
};

export type AdminSettingHistoryItemApi = {
  id?: string;
  changedAt: string;
  changedBy: string;
  prevValue: unknown;
  newValue: unknown;
  reason?: string | null;
};

export const adminSettingsApi = {
  get: <T = unknown>(key: string) =>
    apiClient.get<AdminSettingValueApi<T>>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
    ),

  set: <T = unknown>(key: string, value: T, reason?: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      reason ? { value, reason } : { value },
    ),

  history: (key: string) =>
    apiClient.get<{ items: AdminSettingHistoryItemApi[] }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}/history`,
    ),
};
