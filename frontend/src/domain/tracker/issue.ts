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
  /**
   * Tracker Boards (2026-05-27) — доска задачи. Nullable на схеме (legacy
   * до backfill), фактически после миграции всегда заполнено.
   */
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
  /**
   * Phase 3 part C — AI-подсказки, приходят только из POST `/issues`
   * с `inferSuggestions=true`. Остальные эндпоинты поле не возвращают
   * (поэтому optional). Контракт:
   *   `backend/src/modules/tracker/dto/issues/issue-response.dto.ts`.
   */
  aiSuggestions?: IssueAiSuggestionsApi | null;
  /**
   * Tracker subtasks UI (2026-05-27) — число прямых детей задачи. Приходит
   * только в `GET /projects/:projectId/issues?includeChildrenCount=true`.
   * Используется фронтом для badge «N/M» на канбан-карточке.
   */
  childrenCount?: number;
}

/** AI-подсказки для свежесозданной задачи (см. IssueApi.aiSuggestions). */
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
    source: 'knn' | 'llm';
  } | null;
}

/**
 * Phase 3 — DTO «похожей» задачи из `GET /tracker/issues/:id/similar`.
 * Контракт: `backend/src/modules/tracker/dto/issues/similar-issue.dto.ts`.
 *
 * `similarity` ∈ [0, 1] — это `1 - cosine_distance`. Выше = ближе.
 */
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
  /**
   * Tracker Boards (2026-05-27) — доска задачи. Nullable на схеме (legacy
   * до backfill), фактически после миграции всегда заполнено.
   */
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
  /**
   * Tracker subtasks UI (2026-05-27) — число прямых детей. Заполняется
   * только когда фронт явно запрашивает `includeChildrenCount=true`.
   * `null` = поле не запрашивалось / неизвестно.
   */
  childrenCount: number | null;
  // ─ computed ─
  /** dueDate < today (00:00) и задача не завершена. */
  isOverdue: boolean;
  isCompleted: boolean;
  isArchived: boolean;
}

/**
 * Tracker subtasks UI (2026-05-27) — упрощённая модель ребёнка задачи
 * из `GET /api/v1/issues/:id/children`. Используется блоком «Подзадачи».
 *
 * Контракт: `backend/src/modules/tracker/dto/issues/issue-response.dto.ts`
 * (IssueChildResponseDto).
 */
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

/**
 * Доменная модель «похожей» задачи (KNN). `completedAt: Date | null` —
 * парсим из строки ApiDto. `similarity` сохраняем как есть.
 */
export interface SimilarIssue {
  id: string;
  identifier: string;
  title: string;
  stateId: string | null;
  projectId: string;
  completedAt: Date | null;
  similarity: number;
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
    // Tracker Boards (2026-05-27)
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
    childrenCount: typeof api.childrenCount === 'number' ? api.childrenCount : null,
    isOverdue: computeIsOverdue(dueDate, completedAt),
    isCompleted: completedAt !== null,
    isArchived: api.archivedAt !== null,
  };
}

/** Маппер `IssueChildApi → IssueChild`. */
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

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Форматирует идентификатор задачи (`KORA-123`). */
export function formatIdentifier(issue: Pick<Issue, 'identifier'>): string {
  return issue.identifier;
}

/** Форматирует similarity (0..1) как «86% похожа». 0.857 → «86% похожа». */
export function similarityLabel(similarity: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, similarity)) * 100);
  return `${pct}% похожа`;
}

/**
 * Относительная дата «вчера» / «3 дн. назад» / «12 июн». Используется в
 * карточке похожей задачи, чтобы показать, когда её закрыли.
 */
export function relativeDateLabel(date: Date | null): string | null {
  if (!date) return null;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    // future — отдаём абсолютную дату; KNN сюда не должна попадать, но
    // подстраховка от часовых поясов.
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} нед. назад`;
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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
