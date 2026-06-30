import { apiClient } from "./api-client";

import { ApiError } from "./api-error";
import type { AvailablePeriodsApi } from "./available-periods.api";

export interface DailyDigestMetricsApi {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topRedCheckIns: Array<{
    checkInId: string;
    personName: string | null;
    excerpt: string;
  }>;
  newBlockers: Array<{
    blockId: string;
    name: string;
    confidence: number;
  }>;
  overdueCommitments: Array<{
    blockId: string;
    name: string;
    dueDate: string | null;
    recipientPersonId: string | null;
  }>;
  goals: {
    completed: number;
    failed: number;
    activated: number;
    completedIds: string[];
    failedIds: string[];
  };
  newHighInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  risksSummary?: string | null;
  ideasSummary?: string | null;
}

export interface DailyDigestVerdictAxisApi {
  key: "team" | "clients" | "execution" | "overall";
  state: "ok" | "warn" | "risk";
  label: string;
  why: string;
}

export interface DailyDigestVerdictApi {
  overall: {
    state: "ok" | "warn" | "risk";
    emoji: string;
    title: string;
    oneLiner: string;
  };
  axes: DailyDigestVerdictAxisApi[];
}

export interface DailyDigestLetterSectionApi {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface DailyDigestGoalAlignmentDayApi {
  direction: "to_goal" | "drift" | "against";
  score: number | null;
  todayDelta: string;
  why: string;
  pro: string[];
  contra: string[];
  goalId?: string | null;
  goalName?: string | null;
}

export interface DailyDigestSourcesApi {
  checkInIds: string[];
  blockerIds: string[];
  commitmentIds: string[];
  goalIds: string[];
  insightIds: string[];
}

export interface DailyDigestEventApi {
  kind: "meeting" | "signal";
  id: string;
  title: string;
  occurredAt: string;
  link: string;
  detail?: string;
}

export interface DailyDigestUrgentItemApi {
  kind: "overdue_commitment" | "high_insight";
  id: string;
  title: string;
  link: string;
  badge: string;
  urgency: "high" | "medium";
}

export interface DailyDigestPersonShinedApi {
  personId: string;
  personName: string;
  reason: "recognition_received" | "helpful_acts" | "commitments_kept";
  detail: string;
  link: string;
}

export interface DailyDigestPersonStruggledApi {
  personId: string;
  personName: string;
  reason: "red_checkin" | "broken_commitment" | "silent_3_days";
  detail: string;
  link: string;
}

export interface DailyDigestChronicBlockerApi {
  id: string;
  representativeText: string;
  status: "new" | "recurring" | "resolved";
  daysOpen: number;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

export interface DailyDigestCustomerAtRiskApi {
  customerName: string;
  riskLevel: "critical" | "warning";
  badge: string;
}

export interface DailyDigestTrendPointApi {
  dateLocal: string;
  totalCheckIns: number;
  greenShare: number;
  redShare: number;
  blockers: number;
  overdueCommitments: number;
  goalsCompleted: number;
  goalsFailed: number;
}

export interface DailyDigestApi {
  id: string;
  tenantId: string;
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsApi;
  sources: DailyDigestSourcesApi;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  eventsToday: DailyDigestEventApi[];
  urgentItems: DailyDigestUrgentItemApi[];
  whoShined: DailyDigestPersonShinedApi[];
  whoStruggled: DailyDigestPersonStruggledApi[];
  customersAtRisk: DailyDigestCustomerAtRiskApi[];
  chronicBlockers: DailyDigestChronicBlockerApi[];
  trend: DailyDigestTrendPointApi[];
  verdict?: DailyDigestVerdictApi | null;
  letter?: DailyDigestLetterSectionApi[] | null;
  goalAlignmentDay?: DailyDigestGoalAlignmentDayApi | null;
}

async function tolerantGet(path: string): Promise<DailyDigestApi | null> {
  try {
    return await apiClient.get<DailyDigestApi>(path);
  } catch (e) {
    if (e instanceof ApiError && e.code === "digest_not_found") {
      return null;
    }
    throw e;
  }
}

export const operationsDailyDigestApi = {
  getByDate: (date: string) =>
    tolerantGet(`/api/v1/dashboard/operations/daily-digest?date=${date}`),

  getLatest: () =>
    tolerantGet("/api/v1/dashboard/operations/daily-digest/latest"),

  generate: (date: string) =>
    apiClient.post<DailyDigestApi>(
      `/api/v1/dashboard/operations/daily-digest/generate?date=${date}`,
      undefined,
    ),

  availablePeriods: (limit?: number) =>
    apiClient.get<AvailablePeriodsApi>(
      `/api/v1/dashboard/operations/daily-digest/available-periods${limit ? `?limit=${limit}` : ""}`,
    ),
};
