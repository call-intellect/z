/**
 * Доменная модель задачи (Issue) трекера.
 *
 * Контракт: `backend/src/modules/tracker/dto/issues/issue-response.dto.ts`.
 *
 * `state` (со статусом / category) подгружается отдельно через `IssueState`
 * запись — но в Phase 2 у нас MVP-набор статусов из defaultStateId; в карточке
 * достаточно `stateId` + опционально `stateCategory` (передаётся в запросе
 * фильтра). Полный объект `state` будет в Phase 3.
 */

import {
  parseIssuePriority,
  type IssuePriority,
  type IssueStateCategory,
} from './enums';

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface IssueApi {
  id: string;
  tenantId: string;
  projectId: string;
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
}

export interface ListIssuesResponseApi {
  items: IssueApi[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Ответ `GET /api/v1/me/inbox` — cursor-based пагинация.
 *
 * `nextCursor` — `id` последней задачи в `items`. Для следующей страницы
 * передать как `?cursor=...`. `nextCursor=null` означает последнюю страницу.
 */
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
  direction: 'out' | 'in';
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

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  tenantId: string;
  projectId: string;
  /** Человеко-читаемый идентификатор `KORA-123`. */
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
  // ─ computed ─
  /** dueDate < today (00:00) и задача не завершена. */
  isOverdue: boolean;
  isCompleted: boolean;
  isArchived: boolean;
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
  direction: 'out' | 'in';
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

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

const parseNumber = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function computeIsOverdue(dueDate: Date | null, completedAt: Date | null): boolean {
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
    isOverdue: computeIsOverdue(dueDate, completedAt),
    isCompleted: completedAt !== null,
    isArchived: api.archivedAt !== null,
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

export function issueAttachmentFromApi(api: IssueAttachmentApi): IssueAttachment {
  return {
    id: api.id,
    issueId: api.issueId,
    commentId: api.commentId,
    uploaderId: api.uploaderId,
    fileName: api.fileName,
    fileUrl: api.fileUrl,
    fileSize: api.fileSize,
    mimeType: api.mimeType,
    thumbnailUrl: api.thumbnailUrl,
    createdAt: new Date(api.createdAt),
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Форматирует идентификатор задачи (`KORA-123`). */
export function formatIdentifier(issue: Pick<Issue, 'identifier'>): string {
  return issue.identifier;
}

/** Текст «Просрочена на N дн.» / «Срок: завтра» / «Срок: 12 июн». */
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
  if (diffDays === 0) return 'Срок сегодня';
  if (diffDays === 1) return 'Срок завтра';
  if (diffDays <= 7) return `Через ${diffDays} дн.`;
  return due.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
