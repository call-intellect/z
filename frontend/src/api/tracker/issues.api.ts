/**
 * API-клиент модуля tracker.issues + relations + attachments + start-meeting.
 *
 * Контракты:
 *   - `backend/src/modules/tracker/controllers/issues.controller.ts`
 *   - `backend/src/modules/tracker/controllers/relations.controller.ts`
 *   - `backend/src/modules/tracker/controllers/attachments.controller.ts`
 */

import { apiClient } from '../api-client';
import { buildQuery, orgHeaders } from '../admin-helpers';
import type {
  IssueActivityApi,
  IssueApi,
  IssueAttachmentApi,
  IssueAttachmentDownloadApi,
  IssueRelationApi,
  IssueVersionApi,
  ListIssuesResponseApi,
  MyInboxResponseApi,
  SimilarIssueApi,
  StartMeetingFromIssueResponseApi,
  IssuePriority,
  IssueStateCategory,
  IssueRelationType,
} from '@/domain/tracker';

export interface ListIssuesRequest {
  stateId?: string;
  stateCategory?: IssueStateCategory;
  assigneeUserId?: string;
  labelId?: string;
  cycleId?: string;
  goalId?: string;
  priority?: IssuePriority;
  parentId?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  q?: string;
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
  assigneeUserIds?: string[];
  labelIds?: string[];
  externalSource?: string | null;
  externalId?: string | null;
  /**
   * Phase 3 part C — попросить backend заполнить `aiSuggestions` в ответе.
   * Когда true и `IssueInferFieldsService` доступен, ответ POST содержит
   * AI-подсказки по assignee/dueDate/priority/goal/labels.
   * Default (undefined) — никаких LLM-вызовов не делается.
   */
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
}

export interface TransitionIssueRequest {
  stateId: string;
  reason?: string | null;
}

/**
 * Query-параметры `GET /api/v1/me/inbox` — фильтры и cursor-пагинация.
 * Контракт: `backend/src/modules/tracker/dto/issues/my-inbox-query.dto.ts`.
 */
export interface MyInboxRequest {
  stateCategory?: IssueStateCategory;
  stateId?: string;
  priority?: IssuePriority;
  projectId?: string;
  labelId?: string;
  cycleId?: string;
  /** ISO-дата. dueDate <= dueBefore. */
  dueBefore?: string;
  /** ISO-дата. dueDate >= dueAfter. */
  dueAfter?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  /** id последней задачи предыдущей страницы. */
  cursor?: string;
  /** 1..100, default 50. */
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
  // ── list / create / detail / patch / delete ──
  list: (
    orgId: string,
    projectId: string,
    req: ListIssuesRequest = {},
  ) =>
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
    apiClient.get<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}`,
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

  // ── my inbox (assignee=me across all projects) ──
  myInbox: (orgId: string, req: MyInboxRequest = {}) =>
    apiClient.get<MyInboxResponseApi>(
      `/api/v1/me/inbox${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Wave 2 polish T6-6a — точный счётчик задач в моём инбоксе.
   * До этого фронт эмулировал ответ через `myInbox({ limit: 1 })` и видел
   * только «есть/нет». Теперь backend отдаёт { total, unread } напрямую.
   * Контракт: `backend/src/modules/tracker/controllers/me-inbox.controller.ts#inboxCount`.
   */
  myInboxCount: (orgId: string) =>
    apiClient.get<{ total: number; unread: number }>(
      `/api/v1/me/inbox/count`,
      { headers: orgHeaders(orgId) },
    ),

  // ── state transition ──
  transition: (orgId: string, issueId: string, body: TransitionIssueRequest) =>
    apiClient.post<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/transitions`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Меняет `sortOrder` задачи внутри колонки канбана. Эндпоинт пока на
   * стороне backend в работе (Wave 2 finishing) — если вернётся 404, frontend
   * сохраняет оптимистичный порядок до следующего refresh.
   *
   * Контракт (предполагаемый):
   *   `PATCH /api/v1/issues/:id/sortOrder` body `{ sortOrder: number }`
   *
   * Альтернатива через uniform `update`-endpoint работает уже сейчас:
   * сервер принимает `sortOrder` в `UpdateIssueRequest`. Используем её как
   * стабильный путь, оставляя сноску для будущего dedicated-endpoint'а.
   */
  reorder: (orgId: string, issueId: string, sortOrder: number) =>
    apiClient.patch<IssueApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}`,
      { sortOrder },
      { headers: orgHeaders(orgId) },
    ),

  // ── assignees ──
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

  // ── labels ──
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

  // ── subscribe ──
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

  // ── goal link ──
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

  // ── start meeting from issue ──
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

  // ── Phase 3: KNN similar issues ──
  /**
   * Возвращает похожие задачи (KNN по pgvector cosine) для данной задачи.
   * Контракт: `GET /api/v1/tracker/issues/:id/similar`.
   * threshold/limit берутся с серверной стороны.
   */
  getSimilar: (orgId: string, issueId: string) =>
    apiClient.get<SimilarIssueApi[]>(
      `/api/v1/tracker/issues/${encodeURIComponent(issueId)}/similar`,
      { headers: orgHeaders(orgId) },
    ),

  // ── activity / versions ──
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

  // ── relations ──
  listRelations: (orgId: string, issueId: string) =>
    apiClient.get<IssueRelationApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/relations`,
      { headers: orgHeaders(orgId) },
    ),

  createRelation: (orgId: string, issueId: string, body: CreateRelationRequest) =>
    apiClient.post<IssueRelationApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/relations`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  removeRelation: (orgId: string, relationId: string) =>
    apiClient.del<void>(
      `/api/v1/relations/${encodeURIComponent(relationId)}`,
      { headers: orgHeaders(orgId) },
    ),

  // ── attachments ──
  uploadAttachment: async (
    orgId: string,
    issueId: string,
    file: File,
    commentId?: string,
  ): Promise<IssueAttachmentApi> => {
    // multipart/form-data — apiClient.post сериализует body как JSON, поэтому
    // здесь идём через нативный fetch с теми же базовыми заголовками.
    const baseUrl =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
    const fd = new FormData();
    fd.append('file', file);
    if (commentId) fd.append('commentId', commentId);
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/issues/${encodeURIComponent(issueId)}/attachments`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Org-Id': orgId },
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
