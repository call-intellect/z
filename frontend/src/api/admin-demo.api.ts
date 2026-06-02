/**
 * API-слой Z-Admin: демо-кабинеты «ТехноСтрим».
 *
 * Эндпоинты — backend `AdminDemoController` (`/api/v1/admin/demo/*`,
 * super-admin only). Вызовы — через единый `apiClient`.
 */
import { apiClient } from './api-client';

export type AdminDemoOrgApi = {
  id: string;
  name: string;
  isReferenceDemo: boolean;
  demoSeededAt: string | null;
  owner: { id: string; email: string; name: string } | null;
};

export type AdminDemoOrgsResponse = { orgs: AdminDemoOrgApi[] };

export const adminDemoApi = {
  listOrgs: () =>
    apiClient.get<AdminDemoOrgsResponse>('/api/v1/admin/demo/orgs'),

  seed: (orgId: string) =>
    apiClient.post<{ ok: true; stats: Record<string, number> }>(
      `/api/v1/admin/demo/orgs/${encodeURIComponent(orgId)}/seed`,
    ),

  reset: (orgId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/demo/orgs/${encodeURIComponent(orgId)}/reset`,
    ),
};
