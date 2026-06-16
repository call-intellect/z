import { apiClient } from "./api-client";
import type {
  AdminExperimentStatusApi,
  AdminFunctionDetailApi,
  AdminFunctionListApi,
} from "@/domain/admin-experiment";

export type StartExperimentRequest = {
  taskType: string;
  modelB: string;
  splitPercent?: number;
  durationDays?: number;
};

export type FinishExperimentRequest = {
  winner: "A" | "B";
};

export const adminExperimentsApi = {
  start: (body: StartExperimentRequest) =>
    apiClient.post<{ ok: true; experiment: unknown }>(
      "/api/v1/admin/experiments",
      body,
    ),

  getStatus: (taskType: string) =>
    apiClient.get<AdminExperimentStatusApi>(
      `/api/v1/admin/experiments/${encodeURIComponent(taskType)}`,
    ),

  finish: (taskType: string, body: FinishExperimentRequest) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/experiments/${encodeURIComponent(taskType)}/finish`,
      body,
    ),

  cancel: (taskType: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/experiments/${encodeURIComponent(taskType)}`,
    ),
};

export const adminFunctionsApi = {
  list: () => apiClient.get<AdminFunctionListApi>("/api/v1/admin/functions"),

  detail: (taskType: string) =>
    apiClient.get<AdminFunctionDetailApi>(
      `/api/v1/admin/functions/${encodeURIComponent(taskType)}`,
    ),
};
