import { apiClient } from './api-client';

export interface WelcomePatchBody {
  teamSize?: string;
  industry?: string;
  painPoints?: string[];
  currentStack?: string[];
  plannedFeatures?: string[];
}

/**
 * QA B6 — прогресс «Настройка компании»: 6 вех «timestamp ИЛИ факт». Считается
 * на бэке (отделы/должности, заведённые вне мастера, тоже зачитываются).
 */
export interface SetupProgressApi {
  completed: number;
  total: number;
  steps: {
    welcome: boolean;
    companyInfo: boolean;
    departments: boolean;
    roles: boolean;
    team: boolean;
    firstActivity: boolean;
  };
}

export const onboardingApi = {
  /** GET /orgs/:orgId/setup-progress — прогресс настройки (timestamp ИЛИ факт) */
  getSetupProgress: (orgId: string) =>
    apiClient.get<SetupProgressApi>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/setup-progress`,
      { headers: { 'X-Org-Id': orgId } },
    ),

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
