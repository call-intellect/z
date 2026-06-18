import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type {
  ListProjectsResponseApi,
  ProjectApi,
  ProjectMemberApi,
} from "@/domain/tracker";

export interface ListProjectsRequest {
  includeArchived?: boolean;
  ownerId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface CreateProjectRequest {
  slug?: string;
  identifier?: string;
  name: string;
  description?: string | null;
  defaultAssigneeId?: string | null;
  network?: 0 | 2;
  timezone?: string;
  cycleViewEnabled?: boolean;
  intakeViewEnabled?: boolean;
  gantViewEnabled?: boolean;
  timeTrackingEnabled?: boolean;
  teamTemplateId?: string | null;
}

export interface CreateProjectFromTemplateRequest {
  templateSlug: string;
  projectName: string;
  identifier: string;
  slug?: string;
  withExampleTasks?: boolean;
  timezone?: string;
}

export interface CreateProjectFromTemplateResponse {
  projectId: string;
  identifier: string;
  slug: string;
  templateSlug: string;
  statesCount: number;
  exampleTasksCount: number;
  regulationStubsCount: number;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  defaultAssigneeId?: string | null;
  defaultStateId?: string | null;
  network?: 0 | 2;
  timezone?: string;
  cycleViewEnabled?: boolean;
  intakeViewEnabled?: boolean;
  gantViewEnabled?: boolean;
  timeTrackingEnabled?: boolean;
}

export interface AddProjectMemberRequest {
  userId: string;
  role?: 5 | 15 | 20;
}

export interface MailInboundLogApi {
  id: string;
  messageId: string;
  fromEmail: string;
  subject: string;
  status: "received" | "bounced" | "failed" | "created";
  reason: string | null;
  issueId: string | null;
  createdAt: string;
}

export interface ProjectEmailInboxApi {
  projectId: string;
  enabled: boolean;
  alias: string | null;
  fullAddress: string | null;
  recentLogs: MailInboundLogApi[];
}

export const projectsApi = {
  list: (orgId: string, req: ListProjectsRequest = {}) =>
    apiClient.get<ListProjectsResponseApi>(
      `/api/v1/projects${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  get: (orgId: string, projectId: string) =>
    apiClient.get<ProjectApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      { headers: orgHeaders(orgId) },
    ),

  getBySlug: (orgId: string, slug: string) =>
    apiClient.get<ProjectApi>(
      `/api/v1/projects/by-slug/${encodeURIComponent(slug)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateProjectRequest) =>
    apiClient.post<ProjectApi>("/api/v1/projects", body, {
      headers: orgHeaders(orgId),
    }),

  createFromTemplate: (orgId: string, body: CreateProjectFromTemplateRequest) =>
    apiClient.post<CreateProjectFromTemplateResponse>(
      "/api/v1/projects/from-template",
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, projectId: string, body: UpdateProjectRequest) =>
    apiClient.patch<ProjectApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, projectId: string) =>
    apiClient.del<void>(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      headers: orgHeaders(orgId),
    }),

  archive: (orgId: string, projectId: string) =>
    apiClient.post<ProjectApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/archive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  unarchive: (orgId: string, projectId: string) =>
    apiClient.post<ProjectApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/unarchive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  listMembers: (orgId: string, projectId: string) =>
    apiClient.get<ProjectMemberApi[]>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/members`,
      { headers: orgHeaders(orgId) },
    ),

  addMember: (
    orgId: string,
    projectId: string,
    body: AddProjectMemberRequest,
  ) =>
    apiClient.post<ProjectMemberApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/members`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeMember: (orgId: string, projectId: string, memberUserId: string) =>
    apiClient.del<void>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(
        memberUserId,
      )}`,
      { headers: orgHeaders(orgId) },
    ),

  getEmailInbox: (orgId: string, projectId: string) =>
    apiClient.get<ProjectEmailInboxApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/email-inbox`,
      { headers: orgHeaders(orgId) },
    ),

  enableEmailInbox: (orgId: string, projectId: string) =>
    apiClient.post<ProjectEmailInboxApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/email-inbox/enable`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  disableEmailInbox: (orgId: string, projectId: string) =>
    apiClient.post<ProjectEmailInboxApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/email-inbox/disable`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  regenerateEmailInboxAlias: (orgId: string, projectId: string) =>
    apiClient.post<ProjectEmailInboxApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/email-inbox/regenerate-alias`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
