import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export type ExecutionPeriod = "day" | "week" | "month";

export type GoalVectorByPersonDirection = "up" | "side" | "down";

export interface GoalVectorByPersonRowApi {
  personId: string;
  personName: string;
  netScore: number;
  proScore: number;
  contraScore: number;
  tasksDone: number;
  tasksOpen: number;
  direction: GoalVectorByPersonDirection;
  reasons: string[];
}

export interface GoalVectorByPersonApi {
  goalId: string | null;
  goalTitle: string | null;
  rows: GoalVectorByPersonRowApi[];
  goalState: "primary" | "active_fallback" | "none";
}

export type IssueChainRelationType = "blocks" | "blocked_by";

export interface IssueChainApi {
  sourceIssueId: string;
  sourceIdentifier: string;
  sourceTitle: string;
  targetIssueId: string;
  targetIdentifier: string;
  targetTitle: string;
  relationType: IssueChainRelationType;
}

export interface IssueChainsApi {
  chains: IssueChainApi[];
}

export type LoadByPersonLevel = "overload" | "normal" | "idle";

export interface LoadByPersonRowApi {
  userId: string;
  personName: string;
  activeTasks: number;
  level: LoadByPersonLevel;
}

export interface LoadByPersonApi {
  rows: LoadByPersonRowApi[];
}

export interface OperationsTrendApi {
  period: "day" | "week" | "month";
  current: Record<string, number> | null;
  previous: Record<string, number> | null;
  deltas: Record<string, number>;
}

export const executionDashboardApi = {
  getGoalVectorByPerson: (
    orgId: string,
    params: { goalId?: string; period: ExecutionPeriod },
  ) => {
    const usp = new URLSearchParams();
    usp.set("period", params.period);
    if (params.goalId) usp.set("goalId", params.goalId);
    return apiClient.get<GoalVectorByPersonApi>(
      `/api/v1/dashboard/goal-vector/by-person?${usp.toString()}`,
      { headers: orgHeaders(orgId) },
    );
  },

  getIssueChains: (
    orgId: string,
    params: { period: ExecutionPeriod; limit?: number },
  ) => {
    const usp = new URLSearchParams();
    usp.set("period", params.period);
    if (params.limit !== undefined) usp.set("limit", String(params.limit));
    return apiClient.get<IssueChainsApi>(
      `/api/v1/dashboard/issue-chains?${usp.toString()}`,
      { headers: orgHeaders(orgId) },
    );
  },

  getLoadByPerson: (orgId: string) =>
    apiClient.get<LoadByPersonApi>("/api/v1/dashboard/load/by-person", {
      headers: orgHeaders(orgId),
    }),

  getOperationsTrend: (
    orgId: string,
    params: { period: "day" | "week" | "month" },
  ) =>
    apiClient.get<OperationsTrendApi>(
      `/api/v1/dashboard/operations/trend?period=${encodeURIComponent(
        params.period,
      )}`,
      { headers: orgHeaders(orgId) },
    ),
};
