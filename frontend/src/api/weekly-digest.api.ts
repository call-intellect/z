import { apiClient } from "./api-client";

import { ApiError } from "./api-error";
import type { AvailablePeriodsApi } from "./available-periods.api";

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
  risksSummary?: string | null;
  ideasSummary?: string | null;
}

export interface WeeklyDigestVerdictAxisApi {
  key: "team" | "clients" | "execution" | "overall";
  state: "ok" | "warn" | "risk";
  label: string;
  why: string;
}

export interface WeeklyDigestVerdictApi {
  overall: {
    state: "ok" | "warn" | "risk";
    emoji: string;
    title: string;
    oneLiner: string;
  };
  axes: WeeklyDigestVerdictAxisApi[];
}

export interface WeeklyDigestLetterSectionApi {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface WeeklyDigestGoalAlignmentWeekApi {
  direction: "to_goal" | "drift" | "against";
  score: number | null;
  weekDelta: string;
  why: string;
  pro: string[];
  contra: string[];
  goalId?: string | null;
  goalName?: string | null;
}

export type WeeklyDayTrendStateApi = "ok" | "warn" | "risk" | "none";

export interface WeeklyDayTrendAxisApi {
  key: "team" | "clients" | "execution" | "overall";
  days: Array<{ dateLocal: string; state: WeeklyDayTrendStateApi }>;
}

export interface WeeklyDigestSourcesApi {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
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
    | "sentiment_dropped";
  detail: string;
}

export interface WeeklyForecastItemApi {
  metric: "sentiment";
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
  verdict?: WeeklyDigestVerdictApi | null;
  letter?: WeeklyDigestLetterSectionApi[] | null;
  goalAlignmentWeek?: WeeklyDigestGoalAlignmentWeekApi | null;
  dayTrend?: WeeklyDayTrendAxisApi[] | null;
}

async function tolerantGet(
  path: string,
): Promise<WeeklyOperationsDigestApi | null> {
  try {
    return await apiClient.get<WeeklyOperationsDigestApi>(path);
  } catch (e) {
    if (e instanceof ApiError && e.code === "digest_not_found") {
      return null;
    }
    throw e;
  }
}

export const weeklyDigestApi = {
  get: (weekStart: string) =>
    apiClient.get<WeeklyOperationsDigestApi>(
      `/api/v1/dashboard/operations/weekly-digest?weekStart=${weekStart}`,
    ),
  getLatest: () =>
    tolerantGet("/api/v1/dashboard/operations/weekly-digest/latest"),
  generate: (weekStart: string) =>
    apiClient.post<WeeklyOperationsDigestApi>(
      `/api/v1/dashboard/operations/weekly-digest/generate?weekStart=${weekStart}`,
      undefined,
    ),
  availablePeriods: (limit?: number) =>
    apiClient.get<AvailablePeriodsApi>(
      `/api/v1/dashboard/operations/weekly-digest/available-periods${limit ? `?limit=${limit}` : ""}`,
    ),
};
