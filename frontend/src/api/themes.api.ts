import { apiClient } from './api-client';
import type {
  ThemeBranch,
  ThemeDetailApi,
  ThemeListApi,
  ThemeSavedAsCardApi,
  ThemeStatus,
} from '@/domain/theme';

/**
 * API-клиент модуля knowledge-core / themes.
 *
 * Контракт: `backend/src/modules/knowledge-core/api/themes.controller.ts`.
 */

export type ListThemesRequest = {
  branch?: ThemeBranch;
  status?: ThemeStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

function buildListQuery(filters?: ListThemesRequest): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.branch) p.set('branch', filters.branch);
  if (filters.status) p.set('status', filters.status);
  if (filters.q) p.set('q', filters.q);
  if (filters.limit !== undefined) p.set('limit', String(filters.limit));
  if (filters.offset !== undefined) p.set('offset', String(filters.offset));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const themesApi = {
  list: (filters?: ListThemesRequest) =>
    apiClient.get<ThemeListApi>(`/api/v1/knowledge/themes${buildListQuery(filters)}`),

  get: (id: string) =>
    apiClient.get<ThemeDetailApi>(`/api/v1/knowledge/themes/${encodeURIComponent(id)}`),

  saveAsCard: (id: string, body: { name?: string }) =>
    apiClient.post<ThemeSavedAsCardApi>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}/save-as-card`,
      body,
    ),
};
