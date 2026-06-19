import { apiClient } from "./api-client";

const BASE = "/api/v1/admin/integrations/sources";

export type SourceRunStatsApiDto = {
  success: number;
  failed: number;
  running: number;
  skipped: number;
};

export type SourceOverviewItemApiDto = {
  tenantId: string;
  orgName: string | null;
  provider: "bitrix" | "chatbox";
  status: string;
  portalDomain: string | null;
  analysisEnabled: boolean;
  lastError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastRunAt: string | null;
  runs24h: { sync: SourceRunStatsApiDto; analyze: SourceRunStatsApiDto };
};

export type SyncRunItemApiDto = {
  id: string;
  tenantId: string;
  provider: string;
  kind: string;
  scope: string | null;
  refId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  counts: unknown;
  error: string | null;
};

export type SyncRunsPageApiDto = {
  items: SyncRunItemApiDto[];
  nextCursor: string | null;
};

export type SyncRunsQueryParams = {
  provider?: "bitrix" | "chatbox";
  tenantId?: string;
  kind?: "sync" | "analyze";
  status?: "running" | "success" | "failed" | "skipped";
  limit?: number;
  cursor?: string;
};

export const adminIntegrationSourcesApi = {
  overview: (): Promise<SourceOverviewItemApiDto[]> =>
    apiClient.get<SourceOverviewItemApiDto[]>(`${BASE}/overview`),

  runs: (params: SyncRunsQueryParams): Promise<SyncRunsPageApiDto> => {
    const q = new URLSearchParams();
    if (params.provider) q.set("provider", params.provider);
    if (params.tenantId) q.set("tenantId", params.tenantId);
    if (params.kind) q.set("kind", params.kind);
    if (params.status) q.set("status", params.status);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.cursor) q.set("cursor", params.cursor);
    const qs = q.toString();
    return apiClient.get<SyncRunsPageApiDto>(`${BASE}/runs${qs ? `?${qs}` : ""}`);
  },
};
