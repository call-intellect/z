import type { CommentResponseDto } from '../services/comments.service';

import type { BoardResponseDto } from './boards/board-response.dto';
import type { ChecklistItemResponseDto, ChecklistResponseDto } from './checklists/checklist.dto';
import type { CycleResponseDto } from './cycles/cycle-response.dto';
import type { IssueResponseDto } from './issues/issue-response.dto';
import type { ProjectDocumentSummaryDto } from './project-documents/project-document.dto';

export type TrackerWsEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'issue.moved_to_board'
  | 'issue.moved_to_project'
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
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'board.reordered'
  | 'checklist.created'
  | 'checklist.updated'
  | 'checklist.deleted'
  | 'checklist_item.created'
  | 'checklist_item.updated'
  | 'checklist_item.deleted'
  | 'issue.checklist_progress_changed'
  | 'project_document.created'
  | 'project_document.updated'
  | 'project_document.deleted'
  | 'sprint_hint.created'
  | 'sprint_hint.updated'
  | 'sprint_hint.dismissed'
  | 'sprint_hint.resolved';

interface BaseTrackerWsEvent<T extends TrackerWsEventType> {
  type: T;
  tenantId: string;
  timestamp: string;
}

export interface IssueCreatedEvent extends BaseTrackerWsEvent<'issue.created'> {
  projectId: string;
  issue: IssueResponseDto;
}

export interface IssueUpdatedEvent extends BaseTrackerWsEvent<'issue.updated'> {
  projectId: string;
  issue: IssueResponseDto;
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

export interface CycleProgressUpdatedEvent extends BaseTrackerWsEvent<'cycle.progress_updated'> {
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

export interface ActivityFeedNewItemEvent extends BaseTrackerWsEvent<'activity_feed.new_item'> {
  activityId: string;
  issueId: string;
  verb: string;
}

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

export interface BoardCreatedEvent extends BaseTrackerWsEvent<'board.created'> {
  projectId: string;
  board: BoardResponseDto;
}

export interface BoardUpdatedEvent extends BaseTrackerWsEvent<'board.updated'> {
  projectId: string;
  board: BoardResponseDto;
  changedFields: string[];
}

export interface BoardDeletedEvent extends BaseTrackerWsEvent<'board.deleted'> {
  projectId: string;
  boardId: string;
  movedIssuesToBoardId: string;
  movedIssuesCount: number;
}

export interface BoardReorderedEvent extends BaseTrackerWsEvent<'board.reordered'> {
  projectId: string;
  boardIds: string[];
}

export interface IssueMovedToBoardEvent extends BaseTrackerWsEvent<'issue.moved_to_board'> {
  projectId: string;
  issueId: string;
  fromBoardId: string | null;
  toBoardId: string;
}

export interface IssueMovedToProjectEvent extends BaseTrackerWsEvent<'issue.moved_to_project'> {
  issueId: string;
  fromProjectId: string;
  toProjectId: string;
  newIdentifier: string;
  oldIdentifier: string;
}

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

export interface ChecklistItemCreatedEvent extends BaseTrackerWsEvent<'checklist_item.created'> {
  issueId: string;
  checklistId: string;
  item: ChecklistItemResponseDto;
}

export interface ChecklistItemUpdatedEvent extends BaseTrackerWsEvent<'checklist_item.updated'> {
  issueId: string;
  checklistId: string;
  item: ChecklistItemResponseDto;
}

export interface ChecklistItemDeletedEvent extends BaseTrackerWsEvent<'checklist_item.deleted'> {
  issueId: string;
  checklistId: string;
  itemId: string;
}

export interface IssueChecklistProgressChangedEvent extends BaseTrackerWsEvent<'issue.checklist_progress_changed'> {
  projectId: string;
  issueId: string;
  total: number;
  done: number;
}

export interface ProjectDocumentCreatedEvent extends BaseTrackerWsEvent<'project_document.created'> {
  projectId: string;
  document: ProjectDocumentSummaryDto;
}

export interface ProjectDocumentUpdatedEvent extends BaseTrackerWsEvent<'project_document.updated'> {
  projectId: string;
  document: ProjectDocumentSummaryDto;
  changedFields: string[];
}

export interface ProjectDocumentDeletedEvent extends BaseTrackerWsEvent<'project_document.deleted'> {
  projectId: string;
  documentId: string;
}

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

export interface SprintHintDismissedEvent extends BaseTrackerWsEvent<'sprint_hint.dismissed'> {
  cycleId: string;
  projectId: string;
  hintId: string;
}

export interface SprintHintResolvedEvent extends BaseTrackerWsEvent<'sprint_hint.resolved'> {
  cycleId: string;
  projectId: string;
  hintId: string;
}

export type TrackerWsEvent =
  | IssueCreatedEvent
  | IssueUpdatedEvent
  | IssueDeletedEvent
  | IssueMovedToBoardEvent
  | IssueMovedToProjectEvent
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
