import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  IssueTemplateApi,
  IssueTemplateConfig,
} from "@/domain/tracker/recurrence";

export interface CreateIssueTemplateRequest {
  projectId?: string | null;
  name: string;
  config: IssueTemplateConfig;
}

export interface UpdateIssueTemplateRequest {
  name?: string;
  config?: IssueTemplateConfig;
}

export const issueTemplatesApi = {
  list: (orgId: string, projectId?: string | null) =>
    apiClient.get<IssueTemplateApi[]>(
      `/api/v1/issue-templates${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateIssueTemplateRequest) =>
    apiClient.post<IssueTemplateApi>(`/api/v1/issue-templates`, body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateIssueTemplateRequest) =>
    apiClient.patch<IssueTemplateApi>(
      `/api/v1/issue-templates/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  instantiate: (orgId: string, id: string, projectId?: string | null) =>
    apiClient.post<{ issueId: string }>(
      `/api/v1/issue-templates/${encodeURIComponent(id)}/instantiate${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      {},
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<void>(`/api/v1/issue-templates/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),
};
