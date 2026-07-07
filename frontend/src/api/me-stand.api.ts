import type {
  CloneImpact,
  CompanyBlocker,
  CompanyIdeas,
  DayLetter,
  MethodCapturePendingItem,
  MyExpertise,
  MyLoad,
  MyStuck,
  NightLedger,
  PlanSignal,
  RequiresYou,
  TaskBuckets,
} from "@/domain/me-stand";

import { apiClient } from "./api-client";

export const meStandApi = {
  dayLetter: (date?: string) =>
    apiClient.get<DayLetter>(`/api/v1/me/day-letter${date ? `?date=${encodeURIComponent(date)}` : ""}`),

  markDayLetterOpened: (id: string) =>
    apiClient.post<{ ok: true }>(`/api/v1/me/day-letter/${encodeURIComponent(id)}/opened`),

  taskBuckets: (opts?: { projectId?: string; limitPerBucket?: number }) => {
    const params = new URLSearchParams();
    if (opts?.projectId) params.set("projectId", opts.projectId);
    if (opts?.limitPerBucket !== undefined) params.set("limitPerBucket", String(opts.limitPerBucket));
    const q = params.toString();
    return apiClient.get<TaskBuckets>(`/api/v1/me/tasks/buckets${q ? `?${q}` : ""}`);
  },

  methodCapturePending: (limit?: number) =>
    apiClient.get<{ items: MethodCapturePendingItem[] }>(
      `/api/v1/me/tasks/method-capture-pending${limit !== undefined ? `?limit=${limit}` : ""}`,
    ),

  requiresYou: () => apiClient.get<RequiresYou>(`/api/v1/me/requires-you`),

  nightLedger: () => apiClient.get<NightLedger>(`/api/v1/me/night-ledger`),

  load: () => apiClient.get<MyLoad>(`/api/v1/me/load`),

  stuck: () => apiClient.get<MyStuck>(`/api/v1/me/stuck`),

  planSignal: () => apiClient.get<PlanSignal>(`/api/v1/me/check-ins/plan-signal`),

  expertise: () => apiClient.get<MyExpertise>(`/api/v1/me/expertise`),

  cloneImpact: () => apiClient.get<CloneImpact>(`/api/v1/me/clone-impact`),

  companyBlockers: (opts?: { status?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const q = params.toString();
    return apiClient.get<{ items: CompanyBlocker[] }>(
      `/api/v1/me/company-blockers${q ? `?${q}` : ""}`,
    );
  },

  companyIdeas: (limit?: number) =>
    apiClient.get<CompanyIdeas>(
      `/api/v1/me/company-ideas${limit !== undefined ? `?limit=${limit}` : ""}`,
    ),
};
