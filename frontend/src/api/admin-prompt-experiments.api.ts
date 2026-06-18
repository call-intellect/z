import { apiClient } from "./api-client";

export const EXPERIMENT_STATUSES = [
  "draft",
  "running",
  "stopped",
  "completed",
] as const;
export type ExperimentStatusApi = (typeof EXPERIMENT_STATUSES)[number];

export interface PromptExperimentApi {
  id: string;
  orgId: string | null;
  templateAId: string;
  templateBId: string;
  splitPercent: number;
  status: ExperimentStatusApi;
  startedAt: string | null;
  endsAt: string | null;
  createdById: string;
  createdAt: string;
  notes: string | null;
}

export interface ListExperimentsResponseApi {
  items: PromptExperimentApi[];
}

export interface CreateExperimentPayload {
  orgId?: string | null;
  templateAId: string;
  templateBId: string;
  splitPercent: number;
  endsAt?: string | null;
  notes?: string | null;
}

export interface AnalyticsGroupApi {
  group: "A" | "B";
  versionId: string;
  meetingsCount: number;
  positiveFeedback: number;
  negativeFeedback: number;
}

export interface ExperimentAnalyticsApi {
  experiment: PromptExperimentApi;
  groups: AnalyticsGroupApi[];
}

export const adminPromptExperimentsApi = {
  async list(filters?: {
    status?: ExperimentStatusApi;
    orgId?: string | null;
  }): Promise<ListExperimentsResponseApi> {
    const query: string[] = [];
    if (filters?.status)
      query.push(`status=${encodeURIComponent(filters.status)}`);
    if (filters?.orgId !== undefined && filters.orgId !== null) {
      query.push(`orgId=${encodeURIComponent(filters.orgId)}`);
    }
    const suffix = query.length ? `?${query.join("&")}` : "";
    return apiClient.get<ListExperimentsResponseApi>(
      `/api/v1/admin/prompt-experiments${suffix}`,
    );
  },

  async detail(id: string): Promise<PromptExperimentApi> {
    return apiClient.get<PromptExperimentApi>(
      `/api/v1/admin/prompt-experiments/${id}`,
    );
  },

  async create(payload: CreateExperimentPayload): Promise<PromptExperimentApi> {
    return apiClient.post<PromptExperimentApi>(
      `/api/v1/admin/prompt-experiments`,
      payload,
    );
  },

  async start(id: string): Promise<PromptExperimentApi> {
    return apiClient.post<PromptExperimentApi>(
      `/api/v1/admin/prompt-experiments/${id}/start`,
      {},
    );
  },

  async stop(id: string, reason?: string): Promise<PromptExperimentApi> {
    return apiClient.post<PromptExperimentApi>(
      `/api/v1/admin/prompt-experiments/${id}/stop`,
      { reason: reason ?? undefined },
    );
  },

  async analytics(
    id: string,
    range?: { from?: string; to?: string },
  ): Promise<ExperimentAnalyticsApi> {
    const query: string[] = [];
    if (range?.from) query.push(`from=${encodeURIComponent(range.from)}`);
    if (range?.to) query.push(`to=${encodeURIComponent(range.to)}`);
    const suffix = query.length ? `?${query.join("&")}` : "";
    return apiClient.get<ExperimentAnalyticsApi>(
      `/api/v1/admin/prompt-experiments/${id}/analytics${suffix}`,
    );
  },
};
