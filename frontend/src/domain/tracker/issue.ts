import {
  mapPreviewToProvenanceRef,
  type PreviewSourceRefApi,
  type ProvenanceRef,
} from "@/domain/provenance";

import {
  parseIssuePriority,
  type IssuePriority,
  type IssueStateCategory,
} from "./enums";

export interface IssueApi {
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
  goalId: string | null;
  boardId: string | null;
  meetingId: string | null;
  linkedMeetingIds: string[];
  sourceBlockIds: string[];
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
  aiSuggestions?: IssueAiSuggestionsApi | null;
  previewQuote?: string | null;
  previewSourceRef?: PreviewSourceRefApi | null;
  /** Org-wide list (2026-06-18) — категория статуса (только GET /api/v1/issues). */
  stateCategory?: IssueStateCategory | null;
  childrenCount?: number;
}

export interface IssueAiSuggestionsApi {
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
    source: "knn" | "llm";
  } | null;
}

export interface SimilarIssueApi {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  projectId: string;
  completedAt: string | null;
  similarity: number;
}

export interface ListIssuesResponseApi {
  items: IssueApi[];
  total: number;
  page: number;
  limit: number;
}

export interface MyInboxResponseApi {
  items: IssueApi[];
  nextCursor: string | null;
  limit: number;
}

export interface IssueActivityApi {
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

export interface IssueVersionApi {
  id: string;
  issueId: string;
  versionNumber: number;
  snapshot: unknown;
  createdByUserId: string;
  createdAt: string;
}

export interface IssueRelationApi {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  relationType: string;
  createdById: string;
  createdAt: string;
  direction: "out" | "in";
}

export interface IssueAttachmentApi {
  id: string;
  issueId: string;
  commentId: string | null;
  uploaderId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface IssueAttachmentDownloadApi extends IssueAttachmentApi {
  downloadUrl: string;
  expiresAt: string;
}

export interface StartMeetingFromIssueResponseApi {
  meetingId: string;
  meetingUrl: string;
  token: string;
}

export interface Issue {
  id: string;
  tenantId: string;
  projectId: string;
  projectSlug: string | null;
  projectName: string | null;
  identifier: string;
  sequenceId: number;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  descriptionStripped: string | null;
  priority: IssuePriority;
  stateId: string | null;
  parentId: string | null;
  estimatePoints: number | null;
  sortOrder: number;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  cycleId: string | null;
  goalId: string | null;
  boardId: string | null;
  meetingId: string | null;
  linkedMeetingIds: string[];
  sourceBlockIds: string[];
  confidence: number | null;
  createdManually: boolean;
  externalSource: string | null;
  externalId: string | null;
  entityId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
  assigneeUserIds: string[];
  labelIds: string[];
  /** Org-wide list (2026-06-18) — категория статуса для группировки на доске «Все проекты». */
  stateCategory: IssueStateCategory | null;
  childrenCount: number | null;
  checklistTotalCount: number;
  checklistDoneCount: number;
  provenancePreview?: ProvenanceRef | null;
  isOverdue: boolean;
  isCompleted: boolean;
  isArchived: boolean;
}

export interface IssueChildApi {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  stateCategory: IssueStateCategory | null;
  priority: string;
  assigneeUserIds: string[];
  dueDate: string | null;
  completedAt: string | null;
  childrenCount: number;
  sortOrder: number;
}

export interface IssueChildrenResponseApi {
  items: IssueChildApi[];
  total: number;
}

export interface IssueChild {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  stateCategory: IssueStateCategory | null;
  priority: IssuePriority;
  assigneeUserIds: string[];
  dueDate: Date | null;
  completedAt: Date | null;
  childrenCount: number;
  sortOrder: number;
  isCompleted: boolean;
  isOverdue: boolean;
}

export interface IssueActivity {
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
  epoch: bigint | string;
  createdAt: Date;
}

export interface IssueRelation {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  relationType: string;
  createdById: string;
  createdAt: Date;
  direction: "out" | "in";
}

export interface IssueAttachment {
  id: string;
  issueId: string;
  commentId: string | null;
  uploaderId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  thumbnailUrl: string | null;
  createdAt: Date;
}

export interface SimilarIssue {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  projectId: string;
  completedAt: Date | null;
  similarity: number;
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

const parseNumber = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function computeIsOverdue(
  dueDate: Date | null,
  completedAt: Date | null,
): boolean {
  if (!dueDate || completedAt) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate.getTime() < today.getTime();
}

export function issueFromApi(api: IssueApi): Issue {
  const dueDate = parseDate(api.dueDate);
  const completedAt = parseDate(api.completedAt);
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    projectSlug: api.projectSlug ?? null,
    projectName: api.projectName ?? null,
    identifier: api.identifier,
    sequenceId: api.sequenceId,
    title: api.title,
    description: api.description,
    descriptionHtml: api.descriptionHtml,
    descriptionStripped: api.descriptionStripped,
    priority: parseIssuePriority(api.priority),
    stateId: api.stateId,
    parentId: api.parentId,
    estimatePoints: api.estimatePoints,
    sortOrder: api.sortOrder,
    startDate: parseDate(api.startDate),
    dueDate,
    completedAt,
    cycleId: api.cycleId,
    goalId: api.goalId,
    boardId: api.boardId ?? null,
    meetingId: api.meetingId,
    linkedMeetingIds: api.linkedMeetingIds ?? [],
    sourceBlockIds: api.sourceBlockIds ?? [],
    confidence: parseNumber(api.confidence),
    createdManually: api.createdManually,
    externalSource: api.externalSource,
    externalId: api.externalId,
    entityId: api.entityId,
    createdById: api.createdById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    archivedAt: parseDate(api.archivedAt),
    deletedAt: parseDate(api.deletedAt),
    assigneeUserIds: api.assigneeUserIds ?? [],
    labelIds: api.labelIds ?? [],
    stateCategory: api.stateCategory ?? null,
    childrenCount:
      typeof api.childrenCount === "number" ? api.childrenCount : null,
    checklistTotalCount: api.checklistTotalCount ?? 0,
    checklistDoneCount: api.checklistDoneCount ?? 0,
    provenancePreview: mapPreviewToProvenanceRef(
      api.previewQuote,
      api.previewSourceRef,
    ),
    isOverdue: computeIsOverdue(dueDate, completedAt),
    isCompleted: completedAt !== null,
    isArchived: api.archivedAt !== null,
  };
}

export function issueChildFromApi(api: IssueChildApi): IssueChild {
  const dueDate = parseDate(api.dueDate);
  const completedAt = parseDate(api.completedAt);
  return {
    id: api.id,
    identifier: api.identifier,
    title: api.title,
    stateId: api.stateId,
    stateCategory: api.stateCategory,
    priority: parseIssuePriority(api.priority),
    assigneeUserIds: api.assigneeUserIds ?? [],
    dueDate,
    completedAt,
    childrenCount: api.childrenCount,
    sortOrder: api.sortOrder,
    isCompleted: completedAt !== null,
    isOverdue: computeIsOverdue(dueDate, completedAt),
  };
}

export function issueActivityFromApi(api: IssueActivityApi): IssueActivity {
  return {
    id: api.id,
    issueId: api.issueId,
    actorUserId: api.actorUserId,
    actorType: api.actorType,
    agentName: api.agentName,
    verb: api.verb,
    field: api.field,
    oldValue: api.oldValue,
    newValue: api.newValue,
    metadata: api.metadata,
    epoch: api.epoch,
    createdAt: new Date(api.createdAt),
  };
}

export function issueRelationFromApi(api: IssueRelationApi): IssueRelation {
  return {
    id: api.id,
    sourceIssueId: api.sourceIssueId,
    targetIssueId: api.targetIssueId,
    relationType: api.relationType,
    createdById: api.createdById,
    createdAt: new Date(api.createdAt),
    direction: api.direction,
  };
}

export function similarIssueFromApi(api: SimilarIssueApi): SimilarIssue {
  return {
    id: api.id,
    identifier: api.identifier,
    title: api.title,
    stateId: api.stateId,
    projectId: api.projectId,
    completedAt: parseDate(api.completedAt),
    similarity: api.similarity,
  };
}

export function similarityLabel(similarity: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, similarity)) * 100);
  return `${pct}% похожа`;
}

export function relativeDateLabel(date: Date | null): string | null {
  if (!date) return null;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }
  if (diffDays === 0) return "сегодня";
  if (diffDays === 1) return "вчера";
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} нед. назад`;
  }
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function dueDateLabel(dueDate: Date | null): string | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return `Просрочена на ${Math.abs(diffDays)} дн.`;
  if (diffDays === 0) return "Срок сегодня";
  if (diffDays === 1) return "Срок завтра";
  if (diffDays <= 7) return `Через ${diffDays} дн.`;
  return due.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
