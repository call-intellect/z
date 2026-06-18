import { apiClient } from "./api-client";

export interface WeeklyDigestMetricsApi {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    dynamicLabel: string;
  }>;
  topIdeas?: Array<{
    ideaId: string;
    statement: string;
    status: string;
    weight: number;
    supporterCount: number;
  }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  hangingDecisions: Array<{
    decisionId: string;
    statement: string;
    ageDays: number;
  }>;
}

export interface WeeklyDigestSourcesApi {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
  decisionIds: string[];
}

export interface WeeklyKpiDeltaApi {
  label: string;
  current: number;
  previous: number | null;
  delta: number | null;
  unit: "%" | "pts" | "шт";
}

export interface WeeklyTeamDynamicsRowApi {
  departmentId: string;
  departmentName: string;
  signal:
    | "sentiment_improved"
    | "sentiment_dropped"
    | "promises_improved"
    | "promises_dropped";
  detail: string;
}

export interface WeeklyForecastItemApi {
  metric: "sentiment" | "promises" | "hanging_decisions";
  projection: string;
  confidence: "low" | "medium";
}

export interface WeeklyDeltaApi {
  current: number;
  previous: number | null;
  delta: number | null;
}

export interface WeeklyDigestTrendPointApi {
  weekStart: string;
  totalCheckIns: number;
  greenShare: number;
  redShare: number;
  goalsCompleted: number;
  goalsFailed: number;
  blockers: number;
  hangingDecisions: number;
}

export interface WeeklyOperationsDigestApi {
  id: string;
  tenantId: string;
  weekStart: string;
  weekEnd: string;
  bodyMarkdown: string;
  metrics: WeeklyDigestMetricsApi;
  sources: WeeklyDigestSourcesApi;
  llmTaskRouteId: string | null;
  createdAt: string;
  kpiDeltas: WeeklyKpiDeltaApi[];
  teamDynamics: WeeklyTeamDynamicsRowApi[];
  forecast: WeeklyForecastItemApi[];
  sectionDeltas: {
    blockers: WeeklyDeltaApi;
    insights: WeeklyDeltaApi;
    ideas: WeeklyDeltaApi;
  };
  trend: WeeklyDigestTrendPointApi[];
}

export const weeklyDigestApi = {
  get: (weekStart: string) =>
    apiClient.get<WeeklyOperationsDigestApi>(
      `/api/v1/dashboard/operations/weekly-digest?weekStart=${weekStart}`,
    ),
  generate: (weekStart: string) =>
    apiClient.post<WeeklyOperationsDigestApi>(
      `/api/v1/dashboard/operations/weekly-digest/generate?weekStart=${weekStart}`,
      undefined,
    ),
};
