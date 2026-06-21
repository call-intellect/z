import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  IssueFieldDefApi,
  IssueFieldType,
  IssueFieldValueApi,
} from "@/domain/tracker/issue-field";

export interface CreateFieldDefRequest {
  projectId?: string | null;
  name: string;
  type: IssueFieldType;
  config?: { options?: { id: string; name: string; color?: string }[] };
}

export interface SetFieldValueRequest {
  fieldId: string;
  value: unknown;
}

export const issueFieldsApi = {
  listDefs: (orgId: string, projectId?: string | null) =>
    apiClient.get<IssueFieldDefApi[]>(
      `/api/v1/issue-fields${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      { headers: orgHeaders(orgId) },
    ),

  createDef: (orgId: string, body: CreateFieldDefRequest) =>
    apiClient.post<IssueFieldDefApi>(`/api/v1/issue-fields`, body, {
      headers: orgHeaders(orgId),
    }),

  archiveDef: (orgId: string, id: string) =>
    apiClient.del<IssueFieldDefApi>(
      `/api/v1/issue-fields/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  listValues: (orgId: string, issueId: string) =>
    apiClient.get<IssueFieldValueApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/field-values`,
      { headers: orgHeaders(orgId) },
    ),

  setValue: (orgId: string, issueId: string, body: SetFieldValueRequest) =>
    apiClient.post<IssueFieldValueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/field-values`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  deleteValue: (orgId: string, issueId: string, fieldId: string) =>
    apiClient.del<void>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/field-values/${encodeURIComponent(fieldId)}`,
      { headers: orgHeaders(orgId) },
    ),
};
