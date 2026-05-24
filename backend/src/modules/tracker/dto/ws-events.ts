import type { CommentResponseDto } from '../services/comments.service';

import type { CycleResponseDto } from './cycles/cycle-response.dto';
import type { IssueResponseDto } from './issues/issue-response.dto';

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
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'cycle.created'
  | 'cycle.progress_updated'
  | 'cycle.completed'
  | 'intake.new_item'
  | 'intake.triaged'
  | 'activity_feed.new_item';

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

export type TrackerWsEvent =
  | IssueCreatedEvent
  | IssueUpdatedEvent
  | IssueDeletedEvent
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | CycleCreatedEvent
  | CycleProgressUpdatedEvent
  | CycleCompletedEvent
  | IntakeNewItemEvent
  | IntakeTriagedEvent
  | ActivityFeedNewItemEvent;
