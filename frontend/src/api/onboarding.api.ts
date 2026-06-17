import { apiClient } from "./api-client";

export interface WelcomePatchBody {
  teamSize?: string;
  industry?: string;
  painPoints?: string[];
  currentStack?: string[];
  plannedFeatures?: string[];
}

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
  getSetupProgress: (orgId: string) =>
    apiClient.get<SetupProgressApi>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/setup-progress`,
      { headers: { "X-Org-Id": orgId } },
    ),

  patchWelcome: (orgId: string, body: WelcomePatchBody) =>
    apiClient.patch<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/welcome`,
      body,
      {
        headers: { "X-Org-Id": orgId },
      },
    ),

  completeWelcome: (orgId: string) =>
    apiClient.post<{ ok: true; redirectTo: string }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/welcome/complete`,
      {},
      { headers: { "X-Org-Id": orgId } },
    ),

  patchUserRole: (body: { companyRole: string }) =>
    apiClient.patch<{ ok: true }>("/api/v1/users/me", body),

  completeSetup: (orgId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/setup/complete`,
      {},
      { headers: { "X-Org-Id": orgId } },
    ),

  seedDemoWorkspace: (orgId: string) =>
    apiClient.post<{ ok: true; stats: Record<string, number> }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/demo-workspace`,
      {},
      { headers: { "X-Org-Id": orgId } },
    ),

  resetDemoWorkspace: (orgId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/reset-demo`,
      {},
      { headers: { "X-Org-Id": orgId } },
    ),
};
