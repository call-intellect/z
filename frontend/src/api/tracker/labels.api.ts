import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type { LabelApi } from "@/domain/tracker";

export interface ListLabelsRequest {
  projectId?: string;
}

export interface CreateLabelRequest {
  name: string;
  color: string;
  projectId?: string | null;
}

export interface UpdateLabelRequest {
  name?: string;
  color?: string;
}

export const labelsApi = {
  list: (orgId: string, req: ListLabelsRequest = {}) =>
    apiClient.get<LabelApi[]>(`/api/v1/labels${buildQuery({ ...req })}`, {
      headers: orgHeaders(orgId),
    }),

  create: (orgId: string, body: CreateLabelRequest) =>
    apiClient.post<LabelApi>("/api/v1/labels", body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, labelId: string, body: UpdateLabelRequest) =>
    apiClient.patch<LabelApi>(
      `/api/v1/labels/${encodeURIComponent(labelId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, labelId: string) =>
    apiClient.del<void>(`/api/v1/labels/${encodeURIComponent(labelId)}`, {
      headers: orgHeaders(orgId),
    }),
};
