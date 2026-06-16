import { apiClient } from "./api-client";

export type InsightKindApi = "problem" | "risk" | "blocker" | "inefficiency";
export type InsightSeverityApi = "low" | "medium" | "high" | "critical";
export type InsightDynamicApi = "growing" | "stable" | "declining" | "spike";
export type InsightStatusApi =
  | "active"
  | "mitigating"
  | "mitigated"
  | "archived"
  | "false_alarm";

export type InsightCauseCategoryApi =
  | "process_gap"
  | "tooling"
  | "role_skill"
  | "communication"
  | "priority"
  | "resource_constraint"
  | "external"
  | "unknown";

export interface InsightListItemApi {
  id: string;
  kind: InsightKindApi;
  statement: string;
  severity: InsightSeverityApi;
  status: InsightStatusApi;
  dynamicLabel: InsightDynamicApi;
  frequencyScore: number;
  dynamicScore: number;
  affectedEntityIds: string[];
  relatedDecisionIds: string[];
  causeCategory: InsightCauseCategoryApi | null;
  firstObservedAt: string;
  lastObservedAt: string;
  sourceBlocksCount: number;
  confidence: number;
  updatedAt: string;
  createdAt: string;
}

export interface InsightDetailApi extends InsightListItemApi {
  mitigationPlan: string | null;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  dataClass: string;
}

export interface InsightsListResponseApi {
  items: InsightListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InsightsChartResponseApi {
  labels: string[];
  series: Array<{
    kind: InsightKindApi;
    counts: number[];
  }>;
}

export interface TopInsightsResponseApi {
  items: InsightListItemApi[];
}

export type ListInsightsRequest = {
  page?: number;
  limit?: number;
  kind?: InsightKindApi;
  severity?: InsightSeverityApi;
  status?: InsightStatusApi;
  dynamic_label?: InsightDynamicApi;
  affected_entity_id?: string;
  cause_category?: InsightCauseCategoryApi;
  q?: string;
};

export type TopInsightsRequest = {
  limit?: number;
  cause_category?: InsightCauseCategoryApi;
};

function buildQuery(
  filters?: Record<string, string | number | undefined>,
): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const insightsApi = {
  list: (filters?: ListInsightsRequest) =>
    apiClient.get<InsightsListResponseApi>(
      `/api/v1/insights${buildQuery(filters as Record<string, string | number | undefined>)}`,
    ),

  chart: (days = 30) =>
    apiClient.get<InsightsChartResponseApi>(
      `/api/v1/insights/chart${buildQuery({ days })}`,
    ),

  top: (req: number | TopInsightsRequest = 5) => {
    const args: TopInsightsRequest =
      typeof req === "number" ? { limit: req } : req;
    const query = buildQuery({
      limit: args.limit ?? 5,
      cause_category: args.cause_category,
    });
    return apiClient.get<TopInsightsResponseApi>(
      `/api/v1/insights/top${query}`,
    );
  },

  get: (id: string) =>
    apiClient.get<InsightDetailApi>(
      `/api/v1/insights/${encodeURIComponent(id)}`,
    ),

  changeStatus: (
    id: string,
    body: { newStatus: InsightStatusApi; reason?: string },
  ) =>
    apiClient.post<{ ok: true; status: InsightStatusApi }>(
      `/api/v1/insights/${encodeURIComponent(id)}/status`,
      body,
    ),

  setMitigation: (id: string, body: { mitigationPlan: string }) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/insights/${encodeURIComponent(id)}/mitigation`,
      body,
    ),

  changeSeverity: (
    id: string,
    body: { newSeverity: InsightSeverityApi; reason?: string },
  ) =>
    apiClient.post<{ ok: true; severity: InsightSeverityApi }>(
      `/api/v1/insights/${encodeURIComponent(id)}/severity`,
      body,
    ),
};
