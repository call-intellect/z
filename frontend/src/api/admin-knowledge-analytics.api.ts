import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminKnowledgeByOrgApi,
  AdminKnowledgeGrowthApi,
  AdminKnowledgeOverviewApi,
} from "@/domain/admin-knowledge-analytics";
import type { AdminPeriod } from "@/domain/admin-usage";

export type KnowledgeAnalyticsPeriodRequest = {
  period: AdminPeriod;
  from?: string;
  to?: string;
};

export const adminKnowledgeAnalyticsApi = {
  overview: (req: KnowledgeAnalyticsPeriodRequest) =>
    apiClient.get<AdminKnowledgeOverviewApi>(
      `/api/v1/admin/analytics/knowledge/overview${buildQuery({ ...req })}`,
    ),

  byOrg: (req: KnowledgeAnalyticsPeriodRequest & { limit?: number }) =>
    apiClient.get<AdminKnowledgeByOrgApi>(
      `/api/v1/admin/analytics/knowledge/by-org${buildQuery({ ...req })}`,
    ),

  growth: (req: KnowledgeAnalyticsPeriodRequest) =>
    apiClient.get<AdminKnowledgeGrowthApi>(
      `/api/v1/admin/analytics/knowledge/growth${buildQuery({ ...req })}`,
    ),
};
