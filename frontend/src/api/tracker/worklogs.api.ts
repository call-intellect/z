import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  WorklogApi,
  WorklogListApi,
} from "@/domain/tracker/worklog";

export interface CreateWorklogRequest {
  minutes: number;
  startedAt: string;
  description?: string;
}

export const worklogsApi = {
  list: (orgId: string, issueId: string) =>
    apiClient.get<WorklogListApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/worklogs`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, issueId: string, body: CreateWorklogRequest) =>
    apiClient.post<WorklogApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/worklogs`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<void>(`/api/v1/worklogs/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),
};
