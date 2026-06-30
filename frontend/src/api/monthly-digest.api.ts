import { apiClient } from "./api-client";

import { ApiError } from "./api-error";
import type { AvailablePeriodsApi } from "./available-periods.api";

export interface MonthlyDigestMetricsApi {
  weeksCount: number;
  missingWeeks: string[];
  avgGreenShare: number;
  avgRedShare: number;
  totalCheckIns: number;
  goalsCompleted: number;
  goalsFailed: number;
  topBlockers: Array<{ text: string; count: number }>;
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
  decisions?: Array<{ title: string; why: string }>;
  nextFocus?: Array<{ title: string; why: string }>;
  risksSummary?: string | null;
  ideasSummary?: string | null;
}

export interface MonthlyDigestVerdictAxisApi {
  key: "team" | "clients" | "execution" | "overall";
  state: "ok" | "warn" | "risk";
  label: string;
  why: string;
}

export interface MonthlyDigestVerdictApi {
  overall: {
    state: "ok" | "warn" | "risk";
    emoji: string;
    title: string;
    oneLiner: string;
  };
  axes: MonthlyDigestVerdictAxisApi[];
}

export interface MonthlyDigestLetterSectionApi {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface MonthlyDigestPaceApi {
  factToGoal: number | null;
  planToGoal: number | null;
  etaIso: string | null;
  leadingSignal: string | null;
}

export interface MonthlyDigestGoalAlignmentMonthApi {
  direction: "to_goal" | "drift" | "against";
  score: number | null;
  monthDelta: string;
  pace: MonthlyDigestPaceApi;
  why: string;
  pro: string[];
  contra: string[];
  goalId?: string | null;
  goalName?: string | null;
}

export type MonthWeekTrendStateApi = "ok" | "warn" | "risk" | "none";

export interface MonthWeekTrendAxisApi {
  key: "team" | "clients" | "execution" | "overall";
  weeks: Array<{ weekStart: string; state: MonthWeekTrendStateApi }>;
}

export interface MonthlyDigestSourcesApi {
  weeklyDigestIds: string[];
  goalIds: string[];
}

export interface MonthlyOperationsDigestApi {
  id: string;
  tenantId: string;
  periodYm: string;
  bodyMarkdown: string;
  metrics: MonthlyDigestMetricsApi;
  sources: MonthlyDigestSourcesApi;
  llmTaskRouteId: string | null;
  createdAt: string;
  shortSummary?: string | null;
  deliveredAt?: string | null;
  verdict?: MonthlyDigestVerdictApi | null;
  letter?: MonthlyDigestLetterSectionApi[] | null;
  goalAlignmentMonth?: MonthlyDigestGoalAlignmentMonthApi | null;
  weekTrend?: MonthWeekTrendAxisApi[] | null;
}

async function tolerantGet(
  path: string,
): Promise<MonthlyOperationsDigestApi | null> {
  try {
    return await apiClient.get<MonthlyOperationsDigestApi>(path);
  } catch (e) {
    if (e instanceof ApiError && e.code === "digest_not_found") {
      return null;
    }
    throw e;
  }
}

export const monthlyDigestApi = {
  get: (period: string) =>
    apiClient.get<MonthlyOperationsDigestApi>(
      `/api/v1/dashboard/operations/monthly-digest?period=${period}`,
    ),
  getLatest: () =>
    tolerantGet("/api/v1/dashboard/operations/monthly-digest/latest"),
  generate: (period: string) =>
    apiClient.post<MonthlyOperationsDigestApi>(
      `/api/v1/dashboard/operations/monthly-digest/generate?period=${period}`,
      undefined,
    ),
  availablePeriods: (limit?: number) =>
    apiClient.get<AvailablePeriodsApi>(
      `/api/v1/dashboard/operations/monthly-digest/available-periods${limit ? `?limit=${limit}` : ""}`,
    ),
};
