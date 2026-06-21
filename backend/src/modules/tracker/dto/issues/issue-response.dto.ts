import type { ProvenancePreviewRef } from '../../../knowledge-core/services/provenance.service';

export interface IssueResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  projectSlug?: string | null;
  projectName?: string | null;
  identifier: string;
  sequenceId: number;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  descriptionStripped: string | null;
  priority: string;
  stateId: string | null;
  parentId: string | null;
  estimatePoints: number | null;
  sortOrder: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  cycleId: string | null;
  cycleName?: string | null;
  goalId: string | null;
  goalName?: string | null;
  boardId: string | null;
  meetingId: string | null;
  linkedMeetingIds: string[];
  sourceBlockIds: string[];
  previewQuote: string | null;
  previewSourceRef: ProvenancePreviewRef | null;
  confidence: string | null;
  createdManually: boolean;
  externalSource: string | null;
  externalId: string | null;
  entityId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  assigneeUserIds: string[];
  labelIds: string[];
  checklistTotalCount: number;
  checklistDoneCount: number;
  commentCount?: number | null;
  attachmentCount?: number | null;
  aiSuggestions?: IssueAiSuggestionsDto | null;
  childrenCount?: number;
  /**
   * Org-wide list (2026-06-18) — категория статуса задачи. Заполняется ТОЛЬКО
   * эндпоинтом `GET /api/v1/issues` (фронт группирует кросс-проектные карточки
   * по 5 колонкам-категориям). На прочих эндпоинтах поле отсутствует.
   */
  stateCategory?:
    | 'backlog'
    | 'unstarted'
    | 'started'
    | 'completed'
    | 'cancelled'
    | null;
}

export interface IssueChildResponseDto {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  stateCategory: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | null;
  priority: string;
  assigneeUserIds: string[];
  dueDate: string | null;
  completedAt: string | null;
  childrenCount: number;
  sortOrder: number;
}

export interface IssueChildrenResponseDto {
  items: IssueChildResponseDto[];
  total: number;
}

export interface IssueAiSuggestionsDto {
  fields: {
    suggestedAssigneeId: string | null;
    suggestedDueDate: string | null;
    suggestedPriority: string | null;
    suggestedGoalId: string | null;
    suggestedLabels: string[];
    confidence: number;
    meetsThreshold: boolean;
    reasoning: string | null;
  } | null;
  goal: {
    goalId: string;
    confidence: number;
    source: 'knn' | 'llm';
  } | null;
}

export interface ListIssuesResponse {
  items: IssueResponseDto[];
  total: number;
  page: number;
  limit: number;
}

export interface MyInboxResponseDto {
  items: IssueResponseDto[];
  nextCursor: string | null;
  limit: number;
}

export interface MyInboxCountDto {
  total: number;
  unread: number;
}

export interface IssueActivityDto {
  id: string;
  issueId: string;
  actorUserId: string | null;
  actorType: string;
  agentName: string | null;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  epoch: string;
  createdAt: string;
}

export interface IssueVersionDto {
  id: string;
  issueId: string;
  versionNumber: number;
  snapshot: unknown;
  createdByUserId: string;
  createdAt: string;
}
