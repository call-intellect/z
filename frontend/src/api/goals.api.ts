import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";
import type {
  GoalDetailApi,
  GoalHorizon,
  GoalKeyResultApi,
  GoalKrSourceKind,
  GoalListApi,
  GoalListItemApi,
  GoalStatus,
} from "@/domain/goal";

export type ListGoalsRequest = {
  status?: GoalStatus | "all";
  limit?: number;
};

export type CreateGoalRequest = {
  name: string;
  description: string;
  targetDate?: string | null;
  weight?: number;
  ownerPersonId?: string | null;
};

export type UpdateGoalRequest = {
  name?: string;
  description?: string;
  targetDate?: string | null;
  weight?: number;
  status?: GoalStatus;
  parentGoalId?: string | null;
  horizon?: GoalHorizon;
  progressStatus?: string;
  promotionState?: "suggested" | "active" | "dismissed";
  ownerPersonId?: string | null;
};

export type AddThemesRequest = { themeIds: string[] };

export type CreateKeyResultRequest = {
  name: string;
  unit?: string | null;
  startValue: number;
  targetValue: number;
  currentValue?: number;
  sourceKind?: GoalKrSourceKind;
  sourceConfig?: Record<string, unknown>;
};

export type UpdateKeyResultRequest = {
  name?: string;
  unit?: string | null;
  startValue?: number;
  targetValue?: number;
  currentValue?: number;
  sourceKind?: GoalKrSourceKind;
  sourceConfig?: Record<string, unknown>;
};

export type SupersedeGoalRequest = {
  name?: string;
  description?: string;
  targetDate?: string | null;
  horizon?: GoalHorizon;
  weight?: number;
};

export type SuggestParentVerdict = "duplicate" | "child_of" | "standalone";

export type SuggestParentCandidateApi = {
  goalId: string;
  name: string;
};

export type SuggestParentApi = {
  suggestedParentGoalId: string | null;
  verdict: SuggestParentVerdict;
  candidates: SuggestParentCandidateApi[];
  reasoning: string | null;
  confidence: number | null;
};

export const goalsApi = {
  list: (orgId: string, req: ListGoalsRequest = {}) =>
    apiClient.get<GoalListApi>(`/api/v1/goals${buildQuery({ ...req })}`, {
      headers: orgHeaders(orgId),
    }),

  get: (orgId: string, goalId: string) =>
    apiClient.get<GoalDetailApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateGoalRequest) =>
    apiClient.post<GoalListItemApi>("/api/v1/goals", body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, goalId: string, body: UpdateGoalRequest) =>
    apiClient.patch<GoalListItemApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  archive: (orgId: string, goalId: string) =>
    apiClient.del<{ id: string; archivedAt: string }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}`,
      { headers: orgHeaders(orgId) },
    ),

  addThemes: (orgId: string, goalId: string, body: AddThemesRequest) =>
    apiClient.post<{ added: number; skipped: number }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/themes`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeTheme: (orgId: string, goalId: string, themeId: string) =>
    apiClient.del<{ removed: boolean }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/themes/${encodeURIComponent(themeId)}`,
      { headers: orgHeaders(orgId) },
    ),

  recompute: (orgId: string, goalId: string) =>
    apiClient.post<{ enqueued: true; jobId: string }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/recompute`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  createKeyResult: (
    orgId: string,
    goalId: string,
    body: CreateKeyResultRequest,
  ) =>
    apiClient.post<GoalKeyResultApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/key-results`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  updateKeyResult: (
    orgId: string,
    goalId: string,
    krId: string,
    body: UpdateKeyResultRequest,
  ) =>
    apiClient.patch<GoalKeyResultApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/key-results/${encodeURIComponent(krId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeKeyResult: (orgId: string, goalId: string, krId: string) =>
    apiClient.del<{ removed: boolean }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/key-results/${encodeURIComponent(krId)}`,
      { headers: orgHeaders(orgId) },
    ),

  supersede: (orgId: string, goalId: string, body: SupersedeGoalRequest) =>
    apiClient.post<GoalDetailApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/supersede`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  setPriority: (
    orgId: string,
    goalId: string,
    priority: "must" | "should" | "could" | "wont" | null,
  ) =>
    apiClient.patch<{
      id: string;
      priority: "must" | "should" | "could" | "wont" | null;
    }>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/priority`,
      { priority },
      { headers: orgHeaders(orgId) },
    ),

  suggestParent: (orgId: string, goalId: string) =>
    apiClient.post<SuggestParentApi>(
      `/api/v1/goals/${encodeURIComponent(goalId)}/suggest-parent`,
      {},
      { headers: orgHeaders(orgId) },
    ),
};
