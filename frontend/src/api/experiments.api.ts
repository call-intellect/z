import { apiClient } from "./api-client";

export type ExperimentStatusApi =
  | "hypothesis"
  | "running"
  | "completed"
  | "dropped"
  | "paused";

export type ExperimentLessonTypeApi =
  | "what_worked"
  | "what_failed"
  | "next_time";

export interface ExperimentLessonApi {
  text: string;
  type: ExperimentLessonTypeApi;
  sourceBlockId: string | null;
}

export interface ExperimentListItemApi {
  id: string;
  name: string;
  hypothesisText: string;
  status: ExperimentStatusApi;
  ownerEntityId: string | null;
  currentResult: string | null;
  lessonsCount: number;
  startedAt: string | null;
  completedAt: string | null;
  confidence: number;
  sourceBlocksCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface ExperimentDetailApi extends ExperimentListItemApi {
  lessons: ExperimentLessonApi[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  entityId: string | null;
  currentVersionId: string | null;
  lastConfirmedAt: string | null;
}

export interface ExperimentsListResponseApi {
  items: ExperimentListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type ListExperimentsRequest = {
  page?: number;
  limit?: number;
  status?: ExperimentStatusApi;
  owner_entity_id?: string;
  q?: string;
};

export interface CreateExperimentRequestApi {
  name: string;
  hypothesisText: string;
  ownerEntityId?: string;
  status?: ExperimentStatusApi;
  sourceBlockIds?: string[];
}

export interface UpdateExperimentRequestApi {
  name?: string;
  hypothesisText?: string;
  ownerEntityId?: string | null;
  currentResult?: string | null;
  lessons?: Array<{
    text: string;
    type: ExperimentLessonTypeApi;
    sourceBlockId?: string;
  }>;
}

export interface TransitionExperimentRequestApi {
  to: "running" | "completed" | "dropped" | "paused";
  reason?: string;
}

function buildQuery(
  filters?: Record<string, string | number | undefined>,
): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const experimentsApi = {
  list: (filters?: ListExperimentsRequest) =>
    apiClient.get<ExperimentsListResponseApi>(
      `/api/v1/experiments${buildQuery(filters as Record<string, string | number | undefined>)}`,
    ),

  get: (id: string) =>
    apiClient.get<ExperimentDetailApi>(
      `/api/v1/experiments/${encodeURIComponent(id)}`,
    ),

  create: (body: CreateExperimentRequestApi) =>
    apiClient.post<ExperimentDetailApi>("/api/v1/experiments", body),

  update: (id: string, body: UpdateExperimentRequestApi) =>
    apiClient.patch<ExperimentDetailApi>(
      `/api/v1/experiments/${encodeURIComponent(id)}`,
      body,
    ),

  transition: (id: string, body: TransitionExperimentRequestApi) =>
    apiClient.post<ExperimentDetailApi>(
      `/api/v1/experiments/${encodeURIComponent(id)}/transition`,
      body,
    ),

  delete: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/experiments/${encodeURIComponent(id)}`,
    ),
};
