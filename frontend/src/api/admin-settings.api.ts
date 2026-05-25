/**
 * AdminSettings API — клиент для редактора `AdminSetting` (фундамент Фазы 0,
 * используется страницами Knowledge-Core и Embeddings в Фазе 3).
 *
 * Контракт сервера:
 *   GET   /api/v1/admin/settings/:key                → { key, value, ... }
 *   POST  /api/v1/admin/settings/:key  { value, reason? }
 *   GET   /api/v1/admin/settings/:key/history        → { items: [...] }
 *   GET   /api/v1/admin/settings/schema/:key         → { schema: ... } (опц.)
 *
 * Хуки `useAdminSettingValue` и `useAdminSettingEditor` сами вызывают
 * `apiClient.get/post`. Этот модуль — обёртка-фасад для случаев, когда
 * админ-страница вызывает API напрямую (например, batch-list).
 */
import { apiClient } from './api-client';

export type AdminSettingValueApi<T = unknown> = {
  key: string;
  value: T;
  category?: string;
  section?: string;
  severity?: 'low' | 'medium' | 'high' | 'destructive';
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
  /** Получить одно значение настройки. */
  get: <T = unknown>(key: string) =>
    apiClient.get<AdminSettingValueApi<T>>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
    ),

  /** Сохранить новое значение. severity high/destructive требует reason ≥10 символов. */
  set: <T = unknown>(key: string, value: T, reason?: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      reason ? { value, reason } : { value },
    ),

  /** История последних 50 изменений. */
  history: (key: string) =>
    apiClient.get<{ items: AdminSettingHistoryItemApi[] }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}/history`,
    ),
};
