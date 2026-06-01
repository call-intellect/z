import { apiClient } from './api-client';

export interface WelcomePatchBody {
  teamSize?: string;
  industry?: string;
  painPoints?: string[];
  currentStack?: string[];
  plannedFeatures?: string[];
}

export type DemoSeedStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export const onboardingApi = {
  /** PATCH /orgs/:orgId/welcome — пошаговое сохранение Блока A */
  patchWelcome: (orgId: string, body: WelcomePatchBody) =>
    apiClient.patch<{ ok: true }>(`/api/v1/orgs/${encodeURIComponent(orgId)}/welcome`, body, {
      headers: { 'X-Org-Id': orgId },
    }),

  /** POST /orgs/:orgId/welcome/complete — финал Блока A */
  completeWelcome: (orgId: string) =>
    apiClient.post<{ ok: true; redirectTo: string }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/welcome/complete`,
      {},
      { headers: { 'X-Org-Id': orgId } },
    ),

  /**
   * GET /orgs/:orgId/demo-seed-status — статус авто-заливки демо-кабинета.
   * Используется loading-экраном `/onboarding/welcome/complete` (polling).
   */
  getDemoSeedStatus: (orgId: string) =>
    apiClient.get<{ status: DemoSeedStatus }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/demo-seed-status`,
      { headers: { 'X-Org-Id': orgId } },
    ),

  /** PATCH /users/me — обновить companyRole */
  patchUserRole: (body: { companyRole: string }) =>
    apiClient.patch<{ ok: true }>('/api/v1/users/me', body),

  /** POST /orgs/:orgId/setup/complete — завершение setup-тура (Блок B) */
  completeSetup: (orgId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/setup/complete`,
      {},
      { headers: { 'X-Org-Id': orgId } },
    ),

  /** POST /orgs/:orgId/demo-workspace — загрузить демо-данные «ТехноСтрим» */
  seedDemoWorkspace: (orgId: string) =>
    apiClient.post<{ ok: true; stats: Record<string, number> }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/demo-workspace`,
      {},
      { headers: { 'X-Org-Id': orgId } },
    ),

  /** POST /orgs/:orgId/reset-demo — сбросить демо-данные */
  resetDemoWorkspace: (orgId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/reset-demo`,
      {},
      { headers: { 'X-Org-Id': orgId } },
    ),
};
