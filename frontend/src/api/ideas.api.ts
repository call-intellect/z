import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export type IdeaKindApi = "internal" | "client_request";
export type IdeaStatusApi =
  | "captured"
  | "in_discussion"
  | "accepted"
  | "in_progress"
  | "shipped"
  | "rejected"
  | "archived";

export interface IdeaSupporterApi {
  kind: "person" | "customer";
  entityId: string;
  firstSupportedAt: string;
  blockId?: string;
}

export interface IdeaListItemApi {
  id: string;
  kind: IdeaKindApi;
  status: IdeaStatusApi;
  statement: string;
  rationale: string | null;
  weight: number;
  supporterCount: number;
  clusterId: string | null;
  firstProposedAt: string;
  lastDiscussedAt: string;
  createdByUserId: string | null;
  goalId: string | null;
}

export interface IdeaDetailApi extends IdeaListItemApi {
  supporters: IdeaSupporterApi[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  statusChangedAt: string | null;
  statusChangedByUserId: string | null;
  statusReason: string | null;
  confidence: number;
  dataClass: string;
  realizedAsDecisionId: string | null;
}

export interface IdeasListResponseApi {
  items: IdeaListItemApi[];
  total: number;
  page: number;
  limit: number;
}

export interface TopIdeasResponseApi {
  items: IdeaListItemApi[];
}

export interface IdeaClusterApi {
  id: string;
  name: string;
  description: string | null;
  ideaIds: string[];
  clusterWeight: number;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaClustersListResponseApi {
  items: IdeaClusterApi[];
  total: number;
  page: number;
  limit: number;
}

export interface ListIdeasRequest {
  kind?: IdeaKindApi;
  status?: IdeaStatusApi;
  q?: string;
  clusterId?: string;
  supporterEntityId?: string;
  page?: number;
  limit?: number;
}

export interface MyIdeasRequest {
  role?: "author" | "supporter";
  page?: number;
  limit?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const ideasApi = {
  async list(req: ListIdeasRequest = {}): Promise<IdeasListResponseApi> {
    const url = `/api/v1/ideas${qs(req as Record<string, string | number | undefined>)}`;
    return apiClient.get<IdeasListResponseApi>(url);
  },

  async getById(id: string): Promise<IdeaDetailApi> {
    return apiClient.get<IdeaDetailApi>(
      `/api/v1/ideas/${encodeURIComponent(id)}`,
    );
  },

  async myIdeas(req: MyIdeasRequest = {}): Promise<IdeasListResponseApi> {
    const url = `/api/v1/me/ideas${qs(req as Record<string, string | number | undefined>)}`;
    return apiClient.get<IdeasListResponseApi>(url);
  },

  async top(orgId: string, limit = 5): Promise<TopIdeasResponseApi> {
    return apiClient.get<TopIdeasResponseApi>(
      `/api/v1/ideas/top${qs({ limit })}`,
      { headers: orgHeaders(orgId) },
    );
  },

  async changeStatus(
    id: string,
    newStatus: IdeaStatusApi,
    reason: string | null = null,
  ): Promise<{ ok: true; status: IdeaStatusApi }> {
    return apiClient.post<{ ok: true; status: IdeaStatusApi }>(
      `/api/v1/ideas/${encodeURIComponent(id)}/status`,
      { newStatus, reason },
    );
  },

  async support(id: string): Promise<{ ok: true; supporterCount: number }> {
    return apiClient.post<{ ok: true; supporterCount: number }>(
      `/api/v1/ideas/${encodeURIComponent(id)}/support`,
      {},
    );
  },

  async linkGoal(
    orgId: string,
    ideaId: string,
    goalId: string | null,
  ): Promise<{ ok: true; goalId: string | null }> {
    return apiClient.post<{ ok: true; goalId: string | null }>(
      `/api/v1/ideas/${encodeURIComponent(ideaId)}/goal`,
      { goalId },
      { headers: orgHeaders(orgId) },
    );
  },

  async promoteToGoal(
    orgId: string,
    ideaId: string,
    body: {
      horizon?:
        | "strategic"
        | "annual"
        | "quarterly"
        | "monthly"
        | "sprint";
      parentGoalId?: string | null;
    } = {},
  ): Promise<{ goalId: string; idea: IdeaDetailApi }> {
    return apiClient.post<{ goalId: string; idea: IdeaDetailApi }>(
      `/api/v1/ideas/${encodeURIComponent(ideaId)}/promote-to-goal`,
      body,
      { headers: orgHeaders(orgId) },
    );
  },

  async withdraw(id: string): Promise<{ ok: true }> {
    return apiClient.post<{ ok: true }>(
      `/api/v1/me/ideas/${encodeURIComponent(id)}/withdraw`,
      {},
    );
  },

  async listClusters(
    page: number = 1,
    limit: number = 50,
  ): Promise<IdeaClustersListResponseApi> {
    return apiClient.get<IdeaClustersListResponseApi>(
      `/api/v1/idea-clusters${qs({ page, limit })}`,
    );
  },

  async getClusterById(id: string): Promise<IdeaClusterApi> {
    return apiClient.get<IdeaClusterApi>(
      `/api/v1/idea-clusters/${encodeURIComponent(id)}`,
    );
  },
};
