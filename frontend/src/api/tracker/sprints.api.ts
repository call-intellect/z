import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  SprintArchiveListApi,
  SprintArchivePeriodApi,
  SprintArchiveStatusApi,
  SprintDailyDigestApi,
  SprintDashboardApi,
  SprintReviewStateApi,
  SprintWeeklyDigestApi,
} from "@/domain/sprint";

export interface StartSprintMeetingRequest {
  type?: string;
  title?: string;
  inviteUserIds?: string[];
}

export interface StartSprintMeetingResponse {
  meetingId: string;
  meetingUrl: string;
  token: string;
}

export const sprintsApi = {
  dashboard: (orgId: string, cycleId: string) =>
    apiClient.get<SprintDashboardApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/dashboard`,
      { headers: orgHeaders(orgId) },
    ),

  startMeeting: (
    orgId: string,
    cycleId: string,
    body: StartSprintMeetingRequest,
  ) =>
    apiClient.post<StartSprintMeetingResponse>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/start-meeting`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  getReview: (orgId: string, cycleId: string) =>
    apiClient.get<SprintReviewStateApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/review`,
      { headers: orgHeaders(orgId) },
    ),

  regenerateReview: (orgId: string, cycleId: string) =>
    apiClient.post<SprintReviewStateApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/review/regenerate`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  daily: (orgId: string, cycleId: string) =>
    apiClient.get<SprintDailyDigestApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/dashboard/daily`,
      { headers: orgHeaders(orgId) },
    ),

  weekly: (orgId: string, cycleId: string) =>
    apiClient.get<SprintWeeklyDigestApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/dashboard/weekly`,
      { headers: orgHeaders(orgId) },
    ),

  archive: (
    orgId: string,
    args: {
      period?: SprintArchivePeriodApi;
      status?: SprintArchiveStatusApi | "all";
      q?: string;
    },
  ) => {
    const params = new URLSearchParams();
    if (args.period) params.set("period", args.period);
    if (args.status) params.set("status", args.status);
    if (args.q && args.q.trim()) params.set("q", args.q.trim());
    const qs = params.toString();
    return apiClient.get<SprintArchiveListApi>(
      `/api/v1/sprints/archive${qs ? `?${qs}` : ""}`,
      { headers: orgHeaders(orgId) },
    );
  },
};
