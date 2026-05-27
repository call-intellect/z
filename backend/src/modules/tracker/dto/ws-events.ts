import type { CommentResponseDto } from '../services/comments.service';

import type { BoardResponseDto } from './boards/board-response.dto';
import type {
  ChecklistItemResponseDto,
  ChecklistResponseDto,
} from './checklists/checklist.dto';
import type { CycleResponseDto } from './cycles/cycle-response.dto';
import type { IssueResponseDto } from './issues/issue-response.dto';
import type { ProjectDocumentSummaryDto } from './project-documents/project-document.dto';

/**
 * Контракт WebSocket-событий трекера (`namespace=/ws/tracker`).
 *
 * Все события публикуются как минимум в room `tenant:${tenantId}` (per-tenant
 * подписка живёт всё время сессии). Дополнительно — в более узкие rooms
 * (`project:${projectId}`, `issue:${issueId}`) для тех клиентов, которые на
 * них подписаны явно.
 *
 * Имя event'а = `type`. Структура — единый дискриминированный объединённый тип
 * `TrackerWsEvent`; фронт типизируется по `type`.
 */

export type TrackerWsEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'issue.moved_to_board'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'cycle.created'
  | 'cycle.progress_updated'
  | 'cycle.completed'
  | 'intake.new_item'
  | 'intake.triaged'
  | 'activity_feed.new_item'
  | 'import.progress'
  | 'import.completed'
  | 'import.failed'
  // Tracker Boards (2026-05-27)
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'board.reordered'
  // Tracker Checklists (2026-05-27)
  | 'checklist.created'
  | 'checklist.updated'
  | 'checklist.deleted'
  | 'checklist_item.created'
  | 'checklist_item.updated'
  | 'checklist_item.deleted'
  | 'issue.checklist_progress_changed'
  // Tracker Project Documents (2026-05-27)
  | 'project_document.created'
  | 'project_document.updated'
  | 'project_document.deleted'
  // Sprints (2026-05-28) — подсказки помощника по спринтам.
  | 'sprint_hint.created'
  | 'sprint_hint.updated'
  | 'sprint_hint.dismissed'
  | 'sprint_hint.resolved';

interface BaseTrackerWsEvent<T extends TrackerWsEventType> {
  type: T;
  tenantId: string;
  /** ISO8601 момент эмиссии (по серверу). */
  timestamp: string;
}

export interface IssueCreatedEvent extends BaseTrackerWsEvent<'issue.created'> {
  projectId: string;
  issue: IssueResponseDto;
}

export interface IssueUpdatedEvent extends BaseTrackerWsEvent<'issue.updated'> {
  projectId: string;
  issue: IssueResponseDto;
  /** Список изменённых полей (для тонкого diff'а на UI). */
  changedFields: string[];
}

export interface IssueDeletedEvent extends BaseTrackerWsEvent<'issue.deleted'> {
  projectId: string;
  issueId: string;
}

export interface CommentCreatedEvent extends BaseTrackerWsEvent<'comment.created'> {
  issueId: string;
  comment: CommentResponseDto;
}

export interface CommentUpdatedEvent extends BaseTrackerWsEvent<'comment.updated'> {
  issueId: string;
  comment: CommentResponseDto;
}

export interface CommentDeletedEvent extends BaseTrackerWsEvent<'comment.deleted'> {
  issueId: string;
  commentId: string;
}

export interface CycleCreatedEvent extends BaseTrackerWsEvent<'cycle.created'> {
  projectId: string;
  cycle: CycleResponseDto;
}

export interface CycleProgressUpdatedEvent
  extends BaseTrackerWsEvent<'cycle.progress_updated'> {
  projectId: string;
  cycle: CycleResponseDto;
}

export interface CycleCompletedEvent extends BaseTrackerWsEvent<'cycle.completed'> {
  projectId: string;
  cycleId: string;
  movedIssueCount: number;
  rolledOverTo: string | null;
}

export interface IntakeNewItemEvent extends BaseTrackerWsEvent<'intake.new_item'> {
  intakeId: string;
}

export interface IntakeTriagedEvent extends BaseTrackerWsEvent<'intake.triaged'> {
  intakeId: string;
  decision: 'accept' | 'reject' | 'snooze' | 'duplicate';
  createdIssueId: string | null;
}

export interface ActivityFeedNewItemEvent
  extends BaseTrackerWsEvent<'activity_feed.new_item'> {
  /** id IssueActivity (для последующего fetch'а полной записи REST'ом). */
  activityId: string;
  issueId: string;
  verb: string;
}

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — события импорта.
 *
 * `phase` — текущая стадия для UI: 'boards' | 'states' | 'labels' |
 * 'issues' | 'comments' | 'attachments' | 'finalizing' | 'cancelled'.
 *
 * Эмитятся из `ImportTrackerWorker` (~ каждые 5 секунд во время прогрессии).
 */
export interface ImportProgressEvent extends BaseTrackerWsEvent<'import.progress'> {
  importLogId: string;
  processed: number;
  total: number;
  phase: string;
}

export interface ImportCompletedEvent extends BaseTrackerWsEvent<'import.completed'> {
  importLogId: string;
  summary: {
    totalProjects: number;
    totalIssues: number;
    totalComments: number;
    totalAttachments: number;
    errors: number;
  };
}

export interface ImportFailedEvent extends BaseTrackerWsEvent<'import.failed'> {
  importLogId: string;
  error: string;
}

/**
 * Tracker Boards (2026-05-27) — события CRUD доски + переноса задачи между
 * досками. Эмитятся в `tenant:` + `project:`-room (доска привязана к проекту).
 * Контракт RBAC: подписаны на эти события только участники проекта.
 */

export interface BoardCreatedEvent extends BaseTrackerWsEvent<'board.created'> {
  projectId: string;
  board: BoardResponseDto;
}

export interface BoardUpdatedEvent extends BaseTrackerWsEvent<'board.updated'> {
  projectId: string;
  board: BoardResponseDto;
  /** Список изменённых полей (name|color|icon|description|sequence|archivedAt). */
  changedFields: string[];
}

export interface BoardDeletedEvent extends BaseTrackerWsEvent<'board.deleted'> {
  projectId: string;
  boardId: string;
  /** Доска, на которую перенесены задачи (всегда default). */
  movedIssuesToBoardId: string;
  /** Сколько задач перенеслось. */
  movedIssuesCount: number;
}

export interface BoardReorderedEvent extends BaseTrackerWsEvent<'board.reordered'> {
  projectId: string;
  /** Новый порядок: massive [boardId] — индекс = новый sequence. */
  boardIds: string[];
}

/**
 * Tracker Boards (2026-05-27) — задача перенесена между досками одного
 * проекта (PATCH /issues/:id { boardId }). Эмитится в tenant: + project:
 * + issue: + два room'а для досок (старой и новой) если потребуется в будущем.
 */
export interface IssueMovedToBoardEvent
  extends BaseTrackerWsEvent<'issue.moved_to_board'> {
  projectId: string;
  issueId: string;
  fromBoardId: string | null;
  toBoardId: string;
}

/**
 * Чек-листы задачи (2026-05-27). См. plans/tz/2026-05-27-tracker-checklists.md.
 *
 * Эмитятся в rooms:
 *   - tenant:<tenantId> (всегда)
 *   - issue:<issueId>   (для открытой карточки задачи)
 */
export interface ChecklistCreatedEvent extends BaseTrackerWsEvent<'checklist.created'> {
  issueId: string;
  checklist: ChecklistResponseDto;
}

export interface ChecklistUpdatedEvent extends BaseTrackerWsEvent<'checklist.updated'> {
  issueId: string;
  checklist: ChecklistResponseDto;
}

export interface ChecklistDeletedEvent extends BaseTrackerWsEvent<'checklist.deleted'> {
  issueId: string;
  checklistId: string;
}

export interface ChecklistItemCreatedEvent
  extends BaseTrackerWsEvent<'checklist_item.created'> {
  issueId: string;
  checklistId: string;
  item: ChecklistItemResponseDto;
}

export interface ChecklistItemUpdatedEvent
  extends BaseTrackerWsEvent<'checklist_item.updated'> {
  issueId: string;
  checklistId: string;
  item: ChecklistItemResponseDto;
}

export interface ChecklistItemDeletedEvent
  extends BaseTrackerWsEvent<'checklist_item.deleted'> {
  issueId: string;
  checklistId: string;
  itemId: string;
}

export interface IssueChecklistProgressChangedEvent
  extends BaseTrackerWsEvent<'issue.checklist_progress_changed'> {
  projectId: string;
  issueId: string;
  total: number;
  done: number;
}

/**
 * Tracker Project Documents (2026-05-27).
 *
 * Эмитятся в rooms `tenant:` + `project:`. На `project_document.updated` НЕ
 * передаём содержимое — клиент дотягивает контент отдельным запросом, чтобы
 * не гонять килобайты по WS на каждый auto-save.
 */
export interface ProjectDocumentCreatedEvent
  extends BaseTrackerWsEvent<'project_document.created'> {
  projectId: string;
  document: ProjectDocumentSummaryDto;
}

export interface ProjectDocumentUpdatedEvent
  extends BaseTrackerWsEvent<'project_document.updated'> {
  projectId: string;
  document: ProjectDocumentSummaryDto;
  /** Список изменённых полей (title|content|pinned|parentId|sortOrder). */
  changedFields: string[];
}

export interface ProjectDocumentDeletedEvent
  extends BaseTrackerWsEvent<'project_document.deleted'> {
  projectId: string;
  documentId: string;
}

/**
 * Sprints (2026-05-28) — события подсказок помощника по спринтам.
 *
 * Эмитятся в `tenant:<tenantId>` + `project:<projectId>` (если знаем projectId
 * через linked Cycle.projectId). На страницах `/sprints` и `/sprints/:id` фронт
 * подписан на `tenant:` и инвалидирует SWR-кэш.
 *
 * `hintId` передаётся полем, чтобы UI мог точечно обновить элемент или
 * подтянуть детали через REST. Полный объект подсказки внутрь WS не пихаем —
 * экономим трафик.
 */
export interface SprintHintCreatedEvent extends BaseTrackerWsEvent<'sprint_hint.created'> {
  cycleId: string;
  projectId: string;
  hintId: string;
  severity: 'critical' | 'warning' | 'info';
  kind: string;
}

export interface SprintHintUpdatedEvent extends BaseTrackerWsEvent<'sprint_hint.updated'> {
  cycleId: string;
  projectId: string;
  hintId: string;
}

export interface SprintHintDismissedEvent
  extends BaseTrackerWsEvent<'sprint_hint.dismissed'> {
  cycleId: string;
  projectId: string;
  hintId: string;
}

export interface SprintHintResolvedEvent
  extends BaseTrackerWsEvent<'sprint_hint.resolved'> {
  cycleId: string;
  projectId: string;
  hintId: string;
}

export type TrackerWsEvent =
  | IssueCreatedEvent
  | IssueUpdatedEvent
  | IssueDeletedEvent
  | IssueMovedToBoardEvent
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | CycleCreatedEvent
  | CycleProgressUpdatedEvent
  | CycleCompletedEvent
  | IntakeNewItemEvent
  | IntakeTriagedEvent
  | ActivityFeedNewItemEvent
  | ImportProgressEvent
  | ImportCompletedEvent
  | ImportFailedEvent
  | BoardCreatedEvent
  | BoardUpdatedEvent
  | BoardDeletedEvent
  | BoardReorderedEvent
  | ChecklistCreatedEvent
  | ChecklistUpdatedEvent
  | ChecklistDeletedEvent
  | ChecklistItemCreatedEvent
  | ChecklistItemUpdatedEvent
  | ChecklistItemDeletedEvent
  | IssueChecklistProgressChangedEvent
  | ProjectDocumentCreatedEvent
  | ProjectDocumentUpdatedEvent
  | ProjectDocumentDeletedEvent
  | SprintHintCreatedEvent
  | SprintHintUpdatedEvent
  | SprintHintDismissedEvent
  | SprintHintResolvedEvent;
