import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  ListSprintHintsResponseApi,
  SprintHintApi,
} from "@/domain/sprint";

export const sprintHintsApi = {
  listByCycle: (orgId: string, cycleId: string) =>
    apiClient.get<ListSprintHintsResponseApi>(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/hints`,
      { headers: orgHeaders(orgId) },
    ),

  dismiss: (orgId: string, hintId: string) =>
    apiClient.post<SprintHintApi>(
      `/api/v1/sprint-hints/${encodeURIComponent(hintId)}/dismiss`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  resolve: (orgId: string, hintId: string) =>
    apiClient.post<SprintHintApi>(
      `/api/v1/sprint-hints/${encodeURIComponent(hintId)}/resolve`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
