import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type { ProgressUpdateApi } from "@/domain/tracker/progress-update";

export interface CreateProgressUpdateRequest {
  health: "on_track" | "at_risk" | "off_track";
  body: string;
  doneText?: string;
  nextText?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface UpdateProgressUpdateRequest {
  health?: "on_track" | "at_risk" | "off_track";
  body?: string;
  doneText?: string | null;
  nextText?: string | null;
}

export const progressUpdatesApi = {
  list: (orgId: string, issueId: string) =>
    apiClient.get<ProgressUpdateApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/progress-updates`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, issueId: string, body: CreateProgressUpdateRequest) =>
    apiClient.post<ProgressUpdateApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/progress-updates`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, id: string, body: UpdateProgressUpdateRequest) =>
    apiClient.patch<ProgressUpdateApi>(
      `/api/v1/progress-updates/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  confirm: (
    orgId: string,
    id: string,
    body: UpdateProgressUpdateRequest = {},
  ) =>
    apiClient.post<ProgressUpdateApi>(
      `/api/v1/progress-updates/${encodeURIComponent(id)}/confirm`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<void>(
      `/api/v1/progress-updates/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
};
