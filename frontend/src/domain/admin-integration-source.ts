import type {
  SourceOverviewItemApiDto,
  SourceRunStatsApiDto,
  SyncRunItemApiDto,
} from "@/api/admin-integration-sources.api";

export type SourceRunStats = {
  success: number;
  failed: number;
  running: number;
  skipped: number;
};

export type SourceOverviewItem = {
  tenantId: string;
  orgName: string | null;
  provider: "bitrix" | "chatbox";
  status: string;
  portalDomain: string | null;
  analysisEnabled: boolean;
  lastError: string | null;
  lastFullSyncAt: Date | null;
  lastIncrementalSyncAt: Date | null;
  lastRunAt: Date | null;
  runs24h: { sync: SourceRunStats; analyze: SourceRunStats };
  healthStatus: "ok" | "warn" | "error" | "unknown";
};

export type SyncRunItem = {
  id: string;
  tenantId: string;
  provider: string;
  kind: string;
  scope: string | null;
  refId: string | null;
  status: "running" | "success" | "failed" | "skipped" | string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  counts: unknown;
  error: string | null;
};

function statsFromApi(api: SourceRunStatsApiDto): SourceRunStats {
  return { success: api.success, failed: api.failed, running: api.running, skipped: api.skipped };
}

function healthOf(item: SourceOverviewItemApiDto): SourceOverviewItem["healthStatus"] {
  if (item.status === "error") return "error";
  const s24 = item.runs24h.sync;
  const a24 = item.runs24h.analyze;
  if (s24.failed > 0 || a24.failed > 0) return "warn";
  if (!item.lastFullSyncAt && !item.lastIncrementalSyncAt) return "unknown";
  return "ok";
}

export function sourceOverviewFromApi(api: SourceOverviewItemApiDto): SourceOverviewItem {
  return {
    tenantId: api.tenantId,
    orgName: api.orgName,
    provider: api.provider,
    status: api.status,
    portalDomain: api.portalDomain,
    analysisEnabled: api.analysisEnabled,
    lastError: api.lastError,
    lastFullSyncAt: api.lastFullSyncAt ? new Date(api.lastFullSyncAt) : null,
    lastIncrementalSyncAt: api.lastIncrementalSyncAt ? new Date(api.lastIncrementalSyncAt) : null,
    lastRunAt: api.lastRunAt ? new Date(api.lastRunAt) : null,
    runs24h: {
      sync: statsFromApi(api.runs24h.sync),
      analyze: statsFromApi(api.runs24h.analyze),
    },
    healthStatus: healthOf(api),
  };
}

export function syncRunFromApi(api: SyncRunItemApiDto): SyncRunItem {
  return {
    id: api.id,
    tenantId: api.tenantId,
    provider: api.provider,
    kind: api.kind,
    scope: api.scope,
    refId: api.refId,
    status: api.status as SyncRunItem["status"],
    startedAt: new Date(api.startedAt),
    finishedAt: api.finishedAt ? new Date(api.finishedAt) : null,
    durationMs: api.durationMs,
    counts: api.counts,
    error: api.error,
  };
}
