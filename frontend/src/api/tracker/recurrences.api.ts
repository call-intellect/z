import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  IssueRecurrenceApi,
  IssueTemplateConfig,
  RecurrenceRule,
} from "@/domain/tracker/recurrence";

export interface CreateIssueRecurrenceRequest {
  projectId: string;
  templateIssueId?: string | null;
  rule: RecurrenceRule;
  config: IssueTemplateConfig;
  nextRunAt: string;
  enabled?: boolean;
}

export interface UpdateIssueRecurrenceRequest {
  rule?: RecurrenceRule;
  config?: IssueTemplateConfig;
  nextRunAt?: string;
  enabled?: boolean;
}

export const issueRecurrencesApi = {
  list: (orgId: string, projectId: string) =>
    apiClient.get<IssueRecurrenceApi[]>(
      `/api/v1/issue-recurrences?projectId=${encodeURIComponent(projectId)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateIssueRecurrenceRequest) =>
    apiClient.post<IssueRecurrenceApi>(`/api/v1/issue-recurrences`, body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateIssueRecurrenceRequest) =>
    apiClient.patch<IssueRecurrenceApi>(
      `/api/v1/issue-recurrences/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<void>(
      `/api/v1/issue-recurrences/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
};
