import { apiClient } from './api-client';

export interface WelcomePatchBody {
  teamSize?: string;
  industry?: string;
  painPoints?: string[];
  currentStack?: string[];
  plannedFeatures?: string[];
}

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
};
