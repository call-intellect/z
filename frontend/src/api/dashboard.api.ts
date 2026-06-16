import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";
import type {
  DirectorDashboardApi,
  DirectorDashboardPeriod,
} from "@/domain/director-dashboard";
import type { PeopleAtRiskResponseApi } from "@/domain/people-at-risk";
import type { PulsePatternsApi } from "@/domain/pulse-patterns";
import type { TeamDetailApi } from "@/domain/team-detail";
import type { TeamHealthApi } from "@/domain/team-health";

export const dashboardApi = {
  getDirectorView: (orgId: string, period: DirectorDashboardPeriod) =>
    apiClient.get<DirectorDashboardApi>(
      `/api/v1/dashboard/director?period=${encodeURIComponent(period)}`,
      { headers: orgHeaders(orgId) },
    ),
  getTeamHealth: (orgId: string) =>
    apiClient.get<TeamHealthApi>("/api/v1/dashboard/team-health", {
      headers: orgHeaders(orgId),
    }),
  getTeamDetail: (orgId: string, id: string) =>
    apiClient.get<TeamDetailApi>(
      `/api/v1/dashboard/teams/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
  getPulsePatterns: (orgId: string, period: "week" | "month") =>
    apiClient.get<PulsePatternsApi>(
      `/api/v1/dashboard/pulse-patterns?period=${encodeURIComponent(period)}`,
      { headers: orgHeaders(orgId) },
    ),
  peopleAtRisk: (orgId: string, limit = 3) =>
    apiClient.get<PeopleAtRiskResponseApi>(
      `/api/v1/dashboard/people-at-risk?limit=${encodeURIComponent(limit)}`,
      { headers: orgHeaders(orgId) },
    ),
};
