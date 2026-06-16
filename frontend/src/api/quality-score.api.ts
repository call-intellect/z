import { apiClient } from "./api-client";

export type QualityScoreStatusApi = "pending" | "ready" | "failed" | "disabled";

export type QualityScoreCategoryApi =
  | "preparation"
  | "structure"
  | "clarity"
  | "outcomes"
  | "engagement";

export type QualityScoreSeverityApi = "info" | "warning" | "critical";

export type QualityScoreRecommendationApi = {
  text: string;
  severity: QualityScoreSeverityApi;
  category: QualityScoreCategoryApi;
  degradedMode?: boolean;
};

export type QualityScoreCategoriesApi = {
  preparation: number;
  structure: number;
  clarity: number;
  outcomes: number;
  engagement: number;
};

export type QualityScoreApi = {
  overallScore: number;
  categories: QualityScoreCategoriesApi;
  recommendations: QualityScoreRecommendationApi[];
  strengths: string[];
  computedAt: string;
  degradedMode: boolean;
};

export type QualityScoreResponseApi = {
  status: QualityScoreStatusApi;
  score: QualityScoreApi | null;
};

export type OrgQualityScoreSettingsResponseApi = {
  tenantId: string;
  disabledForTypes: string[];
};

export type OrgDashboardQualityScoreResponseApi = {
  tenantId: string;
  averageScore: number;
  meetingsCount: number;
  byType: Array<{ type: string; avg: number; count: number }>;
  trend: Array<{ date: string; avg: number; count: number }>;
};

export const qualityScoreApi = {
  getForMeeting: (meetingId: string) =>
    apiClient.get<QualityScoreResponseApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/quality-score`,
    ),

  regenerate: (meetingId: string) =>
    apiClient.post<{ status: "queued"; meetingId: string }>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/quality-score/regenerate`,
      {},
    ),

  getOrgSettings: () =>
    apiClient.get<OrgQualityScoreSettingsResponseApi>(
      "/api/v1/org/settings/quality-score",
    ),

  updateOrgSettings: (body: { disabledForTypes: string[] }) =>
    apiClient.patch<OrgQualityScoreSettingsResponseApi>(
      "/api/v1/org/settings/quality-score",
      body,
    ),

  getOrgDashboard: (params: {
    from?: string;
    to?: string;
    meetingType?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.meetingType) qs.set("meetingType", params.meetingType);
    const suffix = qs.toString();
    return apiClient.get<OrgDashboardQualityScoreResponseApi>(
      `/api/v1/org/dashboard/quality-score${suffix ? `?${suffix}` : ""}`,
    );
  },
};
