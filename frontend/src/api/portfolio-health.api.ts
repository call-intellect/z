import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";

export type PortfolioPriorityKey =
  | "must"
  | "should"
  | "could"
  | "wont"
  | "none";

export type PortfolioProgressStatusKey =
  | "on_track"
  | "at_risk"
  | "stalled"
  | "achieved"
  | "dropped";

export type PortfolioHealthLevelApi = "healthy" | "warning" | "critical";

export interface PortfolioPriorityBucketApi {
  count: number;
  achievedCount: number;
  achievedPercent: number;
}

export type PortfolioByPriorityApi = Record<
  PortfolioPriorityKey,
  PortfolioPriorityBucketApi
>;

export type PortfolioByStatusApi = Record<PortfolioProgressStatusKey, number>;

export interface PortfolioRowReasonApi {
  sourceBlockId: string;
}

export interface PortfolioHealthRowApi {
  goalId: string;
  name: string;
  progressStatus: string;
  priority: "must" | "should" | "could" | "wont" | null;
  reason: PortfolioRowReasonApi | null;
}

export interface PortfolioHealthScaleApi {
  healthy: number;
  warning: number;
  level: PortfolioHealthLevelApi;
}

export interface PortfolioHealthApi {
  healthScore: number;
  scale: PortfolioHealthScaleApi;
  byStatus: PortfolioByStatusApi;
  byPriority: PortfolioByPriorityApi;
  rows: PortfolioHealthRowApi[];
  deltaVsPrevWeek: number | null;
}

export const portfolioHealthApi = {
  get: (orgId: string, date?: string) =>
    apiClient.get<PortfolioHealthApi>(
      `/api/v1/dashboard/operations/portfolio-health${buildQuery({ date })}`,
      { headers: orgHeaders(orgId) },
    ),
};
