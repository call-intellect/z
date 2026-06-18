import { apiClient } from "./api-client";

export type BitrixIntegrationStatus =
  | "pending"
  | "connected"
  | "error"
  | "disconnected";

export interface BitrixIntegrationApi {
  id: string;
  portalDomain: string;
  status: BitrixIntegrationStatus;
  scope: string | null;
  hasTokens: boolean;
  lastError: string | null;
  accessExpiresAt: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BitrixSyncScope = "all" | "users" | "dialogs" | "crm";

export interface BitrixStatusApi {
  integration: BitrixIntegrationApi;
  analysisEnabled: boolean;
  runningScopes: BitrixSyncScope[];
  activeSyncScope: BitrixSyncScope | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  counts: {
    users: number;
    dialogs: number;
    sessions: number;
    contacts: number;
    companies: number;
    deals: number;
    leads: number;
    notes: number;
  };
  sessionsByStatus: {
    pending: number;
    analyzing: number;
    done: number;
    failed: number;
  };
}

export type BitrixLinkMode = "none" | "auto" | "manual";

export interface BitrixUserApi {
  externalId: string;
  name: string | null;
  email: string | null;
  position: string | null;
  active: boolean;
  linkMode: BitrixLinkMode;
  linkedPersonId: string | null;
  linkedPersonName: string | null;
}

export interface BitrixPersonOptionApi {
  id: string;
  name: string | null;
  email: string | null;
}

export interface BitrixUsersResponseApi {
  users: BitrixUserApi[];
  personCandidates: BitrixPersonOptionApi[];
}

export type BitrixUserLinkMode = "link" | "unlink" | "create";

export const bitrixApi = {
  getIntegration: () =>
    apiClient.get<BitrixIntegrationApi | null>("/api/v1/bitrix/integration"),

  getStatus: () =>
    apiClient.get<BitrixStatusApi | null>("/api/v1/bitrix/integration/status"),

  getAuthorizeUrl: (domain: string) =>
    apiClient.get<{ url: string }>(
      "/api/v1/bitrix/integration/authorize-url?domain=" +
        encodeURIComponent(domain),
    ),

  test: () =>
    apiClient.post<{ ok: true; app: Record<string, unknown> }>(
      "/api/v1/bitrix/integration/test",
      {},
    ),

  sync: (scope: BitrixSyncScope, since?: string) =>
    apiClient.post<{ ok: true; jobId: string; scope: BitrixSyncScope }>(
      "/api/v1/bitrix/integration/sync?scope=" +
        encodeURIComponent(scope) +
        (since ? "&since=" + encodeURIComponent(since) : ""),
      {},
    ),

  setAnalysis: (enabled: boolean) =>
    apiClient.patch<{ ok: true; analysisEnabled: boolean }>(
      "/api/v1/bitrix/integration/analysis",
      { enabled },
    ),

  listUsers: () =>
    apiClient.get<BitrixUsersResponseApi>("/api/v1/bitrix/integration/users"),

  linkUser: (externalId: string, mode: BitrixUserLinkMode, personId?: string) =>
    apiClient.patch<BitrixUserApi>(
      "/api/v1/bitrix/integration/users/" +
        encodeURIComponent(externalId) +
        "/link",
      personId ? { mode, personId } : { mode },
    ),

  claim: (memberId: string) =>
    apiClient.post<BitrixIntegrationApi>("/api/v1/bitrix/integration/claim", {
      memberId,
    }),

  claimByDomain: (domain: string) =>
    apiClient.post<BitrixIntegrationApi>(
      "/api/v1/bitrix/integration/claim-by-domain",
      { domain },
    ),

  deleteIntegration: () =>
    apiClient.del<{ ok: true }>("/api/v1/bitrix/integration"),
};
