import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type {
  IssueActivityApi,
  IssueApi,
  IssueAttachmentApi,
  IssueAttachmentDownloadApi,
  IssueChildrenResponseApi,
  IssueRelationApi,
  IssueVersionApi,
  ListIssuesResponseApi,
  MyInboxResponseApi,
  SimilarIssueApi,
  StartMeetingFromIssueResponseApi,
  IssuePriority,
  IssueStateCategory,
  IssueRelationType,
} from "@/domain/tracker";

export interface ListIssuesRequest {
  stateId?: string;
  stateCategory?: IssueStateCategory;
  assigneeUserId?: string;
  labelId?: string;
  cycleId?: string;
  goalId?: string;
  boardId?: string;
  priority?: IssuePriority;
  parentId?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  includeChildrenCount?: boolean;
  includeEngagementCount?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

/**
 * Query сквозного списка задач org (`GET /api/v1/issues`). Зеркало backend
 * `ListOrgIssuesQuerySchema`. `projectId` отсутствует → все проекты.
 */
export interface ListOrgIssuesRequest {
  projectId?: string;
  assigneeUserId?: string;
  stateCategory?: IssueStateCategory;
  priority?: IssuePriority;
  cycleId?: string;
  labelId?: string;
  q?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  includeChildrenCount?: boolean;
  includeEngagementCount?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateIssueRequest {
  title: string;
  description?: string | null;
  descriptionHtml?: string | null;
  descriptionStripped?: string | null;
  priority?: IssuePriority;
  stateId?: string | null;
  parentId?: string | null;
  estimatePoints?: number | null;
  sortOrder?: number;
  startDate?: string | null;
  dueDate?: string | null;
  cycleId?: string | null;
  goalId?: string | null;
  boardId?: string | null;
  assigneeUserIds?: string[];
  labelIds?: string[];
  externalSource?: string | null;
  externalId?: string | null;
  inferSuggestions?: boolean;
}

export interface UpdateIssueRequest {
  title?: string;
  description?: string | null;
  descriptionHtml?: string | null;
  descriptionStripped?: string | null;
  priority?: IssuePriority;
  stateId?: string | null;
  parentId?: string | null;
  estimatePoints?: number | null;
  sortOrder?: number;
  startDate?: string | null;
  dueDate?: string | null;
  cycleId?: string | null;
  goalId?: string | null;
  boardId?: string | null;
}

export interface TransitionIssueRequest {
  stateId: string;
  reason?: string | null;
}

export interface MyInboxRequest {
  stateCategory?: IssueStateCategory;
  stateId?: string;
  priority?: IssuePriority;
  projectId?: string;
  labelId?: string;
  cycleId?: string;
  dueBefore?: string;
  dueAfter?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  cursor?: string;
  limit?: number;
}

export interface CreateRelationRequest {
  targetIssueId: string;
  relationType: IssueRelationType;
}

export interface StartMeetingFromIssueRequest {
  inviteUserIds?: string[];
}

export const issuesApi = {
  list: (orgId: string, projectId: string, req: ListIssuesRequest = {}) =>
    apiClient.get<ListIssuesResponseApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/issues${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, projectId: string, body: CreateIssueRequest) =>
    apiClient.post<IssueApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/issues`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  get: (orgId: string, issueId: string) =>
    apiClient.get<IssueApi>(`/api/v1/issues/${encodeURIComponent(issueId)}`, {
      headers: orgHeaders(orgId),
    }),

  getChildren: (orgId: string, issueId: string) =>
    apiClient.get<IssueChildrenResponseApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/children`,
      { headers: orgHeaders(orgId) },
    ),

  getByIdentifier: (orgId: string, identifier: string) =>
    apiClient.get<IssueApi>(
      `/api/v1/issues/by-identifier/${encodeURIComponent(identifier)}`,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, issueId: string, body: UpdateIssueRequest) =>
    apiClient.patch<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, issueId: string) =>
    apiClient.del<void>(`/api/v1/issues/${encodeURIComponent(issueId)}`, {
      headers: orgHeaders(orgId),
    }),

  myInbox: (orgId: string, req: MyInboxRequest = {}) =>
    apiClient.get<MyInboxResponseApi>(
      `/api/v1/me/inbox${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  myInboxCount: (orgId: string) =>
    apiClient.get<{ total: number; unread: number }>(`/api/v1/me/inbox/count`, {
      headers: orgHeaders(orgId),
    }),

  // Сквозной список задач всей организации (рабочий стол «Задачи»).
  listOrg: (orgId: string, req: ListOrgIssuesRequest = {}) =>
    apiClient.get<ListIssuesResponseApi>(
      `/api/v1/issues${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  transition: (orgId: string, issueId: string, body: TransitionIssueRequest) =>
    apiClient.post<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/transitions`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  // Перевод задачи в статус её проекта по КАТЕГОРИИ (DnD на доске «Все проекты»).
  // Backend резолвит конкретный статус по (projectId задачи, category).
  transitionToCategory: (
    orgId: string,
    issueId: string,
    category: IssueStateCategory,
    reason?: string | null,
  ) =>
    apiClient.post<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/transition-to-category`,
      { category, reason: reason ?? null },
      { headers: orgHeaders(orgId) },
    ),

  move: (orgId: string, issueId: string, targetProjectId: string) =>
    apiClient.post<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/move`,
      { targetProjectId },
      { headers: orgHeaders(orgId) },
    ),

  reorder: (orgId: string, issueId: string, sortOrder: number) =>
    apiClient.patch<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}`,
      { sortOrder },
      { headers: orgHeaders(orgId) },
    ),

  addAssignee: (orgId: string, issueId: string, userId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/assignees`,
      { userId },
      { headers: orgHeaders(orgId) },
    ),

  removeAssignee: (orgId: string, issueId: string, userId: string) =>
    apiClient.del<void>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/assignees/${encodeURIComponent(userId)}`,
      { headers: orgHeaders(orgId) },
    ),

  addLabel: (orgId: string, issueId: string, labelId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/labels`,
      { labelId },
      { headers: orgHeaders(orgId) },
    ),

  removeLabel: (orgId: string, issueId: string, labelId: string) =>
    apiClient.del<void>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/labels/${encodeURIComponent(labelId)}`,
      { headers: orgHeaders(orgId) },
    ),

  subscribe: (orgId: string, issueId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/subscribe`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  unsubscribe: (orgId: string, issueId: string) =>
    apiClient.del<void>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/subscribe`,
      { headers: orgHeaders(orgId) },
    ),

  linkGoal: (orgId: string, issueId: string, goalId: string) =>
    apiClient.post<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/link-goal`,
      { goalId },
      { headers: orgHeaders(orgId) },
    ),

  unlinkGoal: (orgId: string, issueId: string) =>
    apiClient.del<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/link-goal`,
      { headers: orgHeaders(orgId) },
    ),

  startMeeting: (
    orgId: string,
    issueId: string,
    body: StartMeetingFromIssueRequest = {},
  ) =>
    apiClient.post<StartMeetingFromIssueResponseApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/start-meeting`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  getSimilar: (orgId: string, issueId: string) =>
    apiClient.get<SimilarIssueApi[]>(
      `/api/v1/tracker/issues/${encodeURIComponent(issueId)}/similar`,
      { headers: orgHeaders(orgId) },
    ),

  activity: (orgId: string, issueId: string) =>
    apiClient.get<IssueActivityApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/activity`,
      { headers: orgHeaders(orgId) },
    ),

  versions: (orgId: string, issueId: string) =>
    apiClient.get<IssueVersionApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/versions`,
      { headers: orgHeaders(orgId) },
    ),

  listRelations: (orgId: string, issueId: string) =>
    apiClient.get<IssueRelationApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/relations`,
      { headers: orgHeaders(orgId) },
    ),

  createRelation: (
    orgId: string,
    issueId: string,
    body: CreateRelationRequest,
  ) =>
    apiClient.post<IssueRelationApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/relations`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeRelation: (orgId: string, relationId: string) =>
    apiClient.del<void>(`/api/v1/relations/${encodeURIComponent(relationId)}`, {
      headers: orgHeaders(orgId),
    }),

  uploadAttachment: async (
    orgId: string,
    issueId: string,
    file: File,
    commentId?: string,
  ): Promise<IssueAttachmentApi> => {
    const baseUrl =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
    const fd = new FormData();
    fd.append("file", file);
    if (commentId) fd.append("commentId", commentId);
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/v1/issues/${encodeURIComponent(issueId)}/attachments`,
      {
        method: "POST",
        credentials: "include",
        headers: { "X-Org-Id": orgId },
        body: fd,
      },
    );
    if (!res.ok) {
      throw new Error(`Загрузка файла не удалась: ${res.status}`);
    }
    return (await res.json()) as IssueAttachmentApi;
  },

  getAttachment: (orgId: string, attachmentId: string) =>
    apiClient.get<IssueAttachmentDownloadApi>(
      `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: orgHeaders(orgId) },
    ),

  removeAttachment: (orgId: string, attachmentId: string) =>
    apiClient.del<void>(
      `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: orgHeaders(orgId) },
    ),
};
