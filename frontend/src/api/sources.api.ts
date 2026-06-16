import { apiClient } from './api-client';
import { orgHeaders, buildQuery } from './admin-helpers';
import type {
  SourceApi,
  SourceListApi,
  SourceTestResultApi,
  SourceTypeApi,
  DataClass,
} from '@/domain/source';

/**
 * API-клиент модуля sources (Фаза 10 knowledge-core).
 *
 * Контракт: `backend/src/modules/sources/sources.controller.ts`.
 * Все эндпоинты под `CookieAuthGuard + TenantGuard` — обязателен заголовок
 * `X-Org-Id` (через `orgHeaders(orgId)`).
 */

export type SourceCreateRequest = {
  type: SourceTypeApi;
  name: string;
  config?: Record<string, unknown> | null;
  dataClass?: DataClass;
};

export type SourceUpdateRequest = {
  name?: string;
  config?: Record<string, unknown> | null;
  dataClass?: DataClass;
  isActive?: boolean;
};

export const sourcesApi = {
  list: (orgId: string, params?: { type?: SourceTypeApi }) =>
    apiClient.get<SourceListApi>(
      `/api/v1/sources${buildQuery({ type: params?.type })}`,
      { headers: orgHeaders(orgId) },
    ),

  get: (orgId: string, id: string) =>
    apiClient.get<SourceApi>(
      `/api/v1/sources/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: SourceCreateRequest) =>
    apiClient.post<SourceApi>('/api/v1/sources', body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: SourceUpdateRequest) =>
    apiClient.patch<SourceApi>(
      `/api/v1/sources/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/sources/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  // Полное удаление источника + его RawEvent (необратимо).
  purge: (orgId: string, id: string) =>
    apiClient.del<{ ok: true; deletedRawEvents: number }>(
      `/api/v1/sources/${encodeURIComponent(id)}/purge`,
      { headers: orgHeaders(orgId) },
    ),

  test: (orgId: string, id: string) =>
    apiClient.post<SourceTestResultApi>(
      `/api/v1/sources/${encodeURIComponent(id)}/test`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
