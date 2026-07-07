import { apiClient } from "./api-client";
import type { PreviewSourceRefApi } from "@/domain/provenance";

export type TaskSolutionStatusApi = "active" | "deprecated" | "archived";

export interface TaskSolutionListItemApi {
  id: string;
  title: string;
  taskDescription: string;
  ownerPersonId: string;
  ownerName: string | null;
  skillTags: string[];
  status: TaskSolutionStatusApi;
  sourceIssueId: string;
  repeatGroupKey: string | null;
  repeatGroupSize: number;
  candidateInstruction: boolean;
  promotedToInstructionId: string | null;
  previewQuote?: string | null;
  previewSourceRef?: PreviewSourceRefApi | null;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface TaskSolutionDetailApi extends TaskSolutionListItemApi {
  solutionMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  version: number;
  dataClass: string;
  sourceIssueIdentifier: string | null;
  sourceIssueTitle: string | null;
}

export interface TaskSolutionsListResponseApi {
  items: TaskSolutionListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TaskSolutionSourceItemApi {
  blockId: string;
  quote: string;
  startMs: number | null;
  meeting: { id: string; title: string; date: string } | null;
}

export interface TaskSolutionSourcesApi {
  items: TaskSolutionSourceItemApi[];
}

export interface TaskSolutionVersionItemApi {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface TaskSolutionHistoryResponseApi {
  items: TaskSolutionVersionItemApi[];
}

export interface TaskSolutionSummaryApi {
  total: number;
  candidates: number;
  weekDelta: number;
}

export type ListTaskSolutionsRequest = {
  page?: number;
  limit?: number;
  q?: string;
  ownerPersonId?: string;
  skill?: string;
  status?: TaskSolutionStatusApi;
  candidateInstruction?: boolean;
  deleted?: boolean;
};

export function buildTaskSolutionsQuery(
  filters?: ListTaskSolutionsRequest,
): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.page) p.set("page", String(filters.page));
  if (filters.limit) p.set("limit", String(filters.limit));
  if (filters.q) p.set("q", filters.q);
  if (filters.ownerPersonId) p.set("ownerPersonId", filters.ownerPersonId);
  if (filters.skill) p.set("skill", filters.skill);
  if (filters.status) p.set("status", filters.status);
  if (filters.candidateInstruction) p.set("candidateInstruction", "true");
  if (filters.deleted) p.set("deleted", "true");
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const taskSolutionsApi = {
  list: (filters?: ListTaskSolutionsRequest) =>
    apiClient.get<TaskSolutionsListResponseApi>(
      `/api/v1/task-solutions${buildTaskSolutionsQuery(filters)}`,
    ),

  get: (id: string) =>
    apiClient.get<TaskSolutionDetailApi>(
      `/api/v1/task-solutions/${encodeURIComponent(id)}`,
    ),

  getSources: (id: string) =>
    apiClient.get<TaskSolutionSourcesApi>(
      `/api/v1/task-solutions/${encodeURIComponent(id)}/sources`,
    ),

  history: (id: string) =>
    apiClient.get<TaskSolutionHistoryResponseApi>(
      `/api/v1/task-solutions/${encodeURIComponent(id)}/history`,
    ),

  getSummary: () =>
    apiClient.get<TaskSolutionSummaryApi>(`/api/v1/task-solutions/summary`),

  confirm: (id: string) =>
    apiClient.post<{ ok: true; lastConfirmedAt: string }>(
      `/api/v1/task-solutions/${encodeURIComponent(id)}/confirm`,
    ),

  remove: (id: string) =>
    apiClient.del<void>(`/api/v1/task-solutions/${encodeURIComponent(id)}`),

  restore: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/task-solutions/${encodeURIComponent(id)}/restore`,
    ),
};
