import { Inject, Injectable, Logger } from '@nestjs/common';

import type { BoardResponseDto } from '../dto/boards/board-response.dto';
import type {
  ChecklistItemResponseDto,
  ChecklistResponseDto,
} from '../dto/checklists/checklist.dto';
import type { CycleResponseDto } from '../dto/cycles/cycle-response.dto';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';
import type {
  ActivityFeedNewItemEvent,
  BoardCreatedEvent,
  BoardDeletedEvent,
  BoardReorderedEvent,
  BoardUpdatedEvent,
  ChecklistCreatedEvent,
  ChecklistDeletedEvent,
  ChecklistItemCreatedEvent,
  ChecklistItemDeletedEvent,
  ChecklistItemUpdatedEvent,
  ChecklistUpdatedEvent,
  CommentCreatedEvent,
  CommentDeletedEvent,
  CommentUpdatedEvent,
  CycleCompletedEvent,
  CycleCreatedEvent,
  CycleProgressUpdatedEvent,
  ImportCompletedEvent,
  ImportFailedEvent,
  ImportProgressEvent,
  IntakeNewItemEvent,
  IntakeTriagedEvent,
  IssueChecklistProgressChangedEvent,
  IssueCreatedEvent,
  IssueDeletedEvent,
  IssueMovedToBoardEvent,
  IssueUpdatedEvent,
  TrackerWsEvent,
} from '../dto/ws-events';
import { TrackerGateway } from '../gateways/tracker.gateway';

import type { CommentResponseDto } from './comments.service';

/**
 * TrackerEventsService — единая точка публикации live-событий трекера в
 * WebSocket. Все методы — fire-and-forget, не бросают исключений из бизнес-
 * транзакций (errors логируются, но не пропагируются).
 *
 * Контракт rooms (`tracker.gateway.ts`):
 *   - tenant:<tenantId>  — главная подписка любого клиента tenant'а
 *   - project:<projectId> — для досок проекта
 *   - issue:<issueId>     — для open-карточки задачи
 *
 * Каждое событие летит в `tenant:` + один-два узких room'а.
 */
@Injectable()
export class TrackerEventsService {
  private readonly logger = new Logger(TrackerEventsService.name);

  constructor(@Inject(TrackerGateway) private readonly gateway: TrackerGateway) {}

  // ── issues ────────────────────────────────────────────────────────────

  publishIssueCreated(issue: IssueResponseDto, tenantId: string): void {
    const event: IssueCreatedEvent = {
      type: 'issue.created',
      tenantId,
      projectId: issue.projectId,
      issue,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(issue.projectId),
    ]);
  }

  publishIssueUpdated(
    issue: IssueResponseDto,
    tenantId: string,
    changedFields: string[],
  ): void {
    const event: IssueUpdatedEvent = {
      type: 'issue.updated',
      tenantId,
      projectId: issue.projectId,
      issue,
      changedFields,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(issue.projectId),
      this.gateway.issueRoom(issue.id),
    ]);
  }

  publishIssueDeleted(
    issueId: string,
    tenantId: string,
    projectId: string,
  ): void {
    const event: IssueDeletedEvent = {
      type: 'issue.deleted',
      tenantId,
      projectId,
      issueId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(projectId),
      this.gateway.issueRoom(issueId),
    ]);
  }

  // ── comments ──────────────────────────────────────────────────────────

  publishCommentCreated(comment: CommentResponseDto, tenantId: string): void {
    const event: CommentCreatedEvent = {
      type: 'comment.created',
      tenantId,
      issueId: comment.issueId,
      comment,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.issueRoom(comment.issueId),
    ]);
  }

  publishCommentUpdated(comment: CommentResponseDto, tenantId: string): void {
    const event: CommentUpdatedEvent = {
      type: 'comment.updated',
      tenantId,
      issueId: comment.issueId,
      comment,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.issueRoom(comment.issueId),
    ]);
  }

  publishCommentDeleted(
    commentId: string,
    tenantId: string,
    issueId: string,
  ): void {
    const event: CommentDeletedEvent = {
      type: 'comment.deleted',
      tenantId,
      issueId,
      commentId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.issueRoom(issueId),
    ]);
  }

  // ── cycles ────────────────────────────────────────────────────────────

  publishCycleCreated(cycle: CycleResponseDto, tenantId: string): void {
    const event: CycleCreatedEvent = {
      type: 'cycle.created',
      tenantId,
      projectId: cycle.projectId,
      cycle,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(cycle.projectId),
    ]);
  }

  publishCycleProgressUpdated(cycle: CycleResponseDto, tenantId: string): void {
    const event: CycleProgressUpdatedEvent = {
      type: 'cycle.progress_updated',
      tenantId,
      projectId: cycle.projectId,
      cycle,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(cycle.projectId),
    ]);
  }

  publishCycleCompleted(args: {
    cycleId: string;
    projectId: string;
    tenantId: string;
    movedIssueCount: number;
    rolledOverTo: string | null;
  }): void {
    const event: CycleCompletedEvent = {
      type: 'cycle.completed',
      tenantId: args.tenantId,
      projectId: args.projectId,
      cycleId: args.cycleId,
      movedIssueCount: args.movedIssueCount,
      rolledOverTo: args.rolledOverTo,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.projectRoom(args.projectId),
    ]);
  }

  // ── intake ────────────────────────────────────────────────────────────

  publishIntakeNewItem(intakeId: string, tenantId: string): void {
    const event: IntakeNewItemEvent = {
      type: 'intake.new_item',
      tenantId,
      intakeId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [this.gateway.tenantRoom(tenantId)]);
  }

  publishIntakeTriaged(args: {
    intakeId: string;
    tenantId: string;
    decision: IntakeTriagedEvent['decision'];
    createdIssueId: string | null;
  }): void {
    const event: IntakeTriagedEvent = {
      type: 'intake.triaged',
      tenantId: args.tenantId,
      intakeId: args.intakeId,
      decision: args.decision,
      createdIssueId: args.createdIssueId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [this.gateway.tenantRoom(args.tenantId)]);
  }

  // ── activity feed (general) ───────────────────────────────────────────

  publishActivity(args: {
    tenantId: string;
    activityId: string;
    issueId: string;
    verb: string;
  }): void {
    const event: ActivityFeedNewItemEvent = {
      type: 'activity_feed.new_item',
      tenantId: args.tenantId,
      activityId: args.activityId,
      issueId: args.issueId,
      verb: args.verb,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  // ── imports (Tracker Phase 5 part 1, 2026-05-24) ──────────────────────

  /**
   * `import.progress` — прогресс импорта. Эмитим ~раз в 5 секунд из
   * ImportTrackerWorker (точечно, после батчей по 50 items).
   */
  publishImportProgress(args: {
    tenantId: string;
    importLogId: string;
    processed: number;
    total: number;
    phase: string;
  }): void {
    const event: ImportProgressEvent = {
      type: 'import.progress',
      tenantId: args.tenantId,
      importLogId: args.importLogId,
      processed: args.processed,
      total: args.total,
      phase: args.phase,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [this.gateway.tenantRoom(args.tenantId)]);
  }

  /** `import.completed` — финальное событие успешного завершения импорта. */
  publishImportCompleted(args: {
    tenantId: string;
    importLogId: string;
    summary: ImportCompletedEvent['summary'];
  }): void {
    const event: ImportCompletedEvent = {
      type: 'import.completed',
      tenantId: args.tenantId,
      importLogId: args.importLogId,
      summary: args.summary,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [this.gateway.tenantRoom(args.tenantId)]);
  }

  /** `import.failed` — финальное событие неуспешного завершения импорта. */
  publishImportFailed(args: {
    tenantId: string;
    importLogId: string;
    error: string;
  }): void {
    const event: ImportFailedEvent = {
      type: 'import.failed',
      tenantId: args.tenantId,
      importLogId: args.importLogId,
      error: args.error,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [this.gateway.tenantRoom(args.tenantId)]);
  }

  // ── boards (Tracker Boards, 2026-05-27) ───────────────────────────────

  publishBoardCreated(board: BoardResponseDto, tenantId: string): void {
    const event: BoardCreatedEvent = {
      type: 'board.created',
      tenantId,
      projectId: board.projectId,
      board,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(board.projectId),
    ]);
  }

  publishBoardUpdated(
    board: BoardResponseDto,
    tenantId: string,
    changedFields: string[],
  ): void {
    const event: BoardUpdatedEvent = {
      type: 'board.updated',
      tenantId,
      projectId: board.projectId,
      board,
      changedFields,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.projectRoom(board.projectId),
    ]);
  }

  publishBoardDeleted(args: {
    tenantId: string;
    projectId: string;
    boardId: string;
    movedIssuesToBoardId: string;
    movedIssuesCount: number;
  }): void {
    const event: BoardDeletedEvent = {
      type: 'board.deleted',
      tenantId: args.tenantId,
      projectId: args.projectId,
      boardId: args.boardId,
      movedIssuesToBoardId: args.movedIssuesToBoardId,
      movedIssuesCount: args.movedIssuesCount,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.projectRoom(args.projectId),
    ]);
  }

  publishBoardReordered(args: {
    tenantId: string;
    projectId: string;
    boardIds: string[];
  }): void {
    const event: BoardReorderedEvent = {
      type: 'board.reordered',
      tenantId: args.tenantId,
      projectId: args.projectId,
      boardIds: args.boardIds,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.projectRoom(args.projectId),
    ]);
  }

  /**
   * Tracker Boards (2026-05-27) — PATCH /issues/:id поменял `boardId`.
   * Эмитим узко (`tenant:` + `project:` + `issue:`).
   */
  publishIssueMovedToBoard(args: {
    tenantId: string;
    projectId: string;
    issueId: string;
    fromBoardId: string | null;
    toBoardId: string;
  }): void {
    const event: IssueMovedToBoardEvent = {
      type: 'issue.moved_to_board',
      tenantId: args.tenantId,
      projectId: args.projectId,
      issueId: args.issueId,
      fromBoardId: args.fromBoardId,
      toBoardId: args.toBoardId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.projectRoom(args.projectId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  // ── checklists (2026-05-27) ───────────────────────────────────────────

  publishChecklistCreated(
    checklist: ChecklistResponseDto,
    tenantId: string,
  ): void {
    const event: ChecklistCreatedEvent = {
      type: 'checklist.created',
      tenantId,
      issueId: checklist.issueId,
      checklist,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.issueRoom(checklist.issueId),
    ]);
  }

  publishChecklistUpdated(
    checklist: ChecklistResponseDto,
    tenantId: string,
  ): void {
    const event: ChecklistUpdatedEvent = {
      type: 'checklist.updated',
      tenantId,
      issueId: checklist.issueId,
      checklist,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(tenantId),
      this.gateway.issueRoom(checklist.issueId),
    ]);
  }

  publishChecklistDeleted(args: {
    tenantId: string;
    issueId: string;
    checklistId: string;
  }): void {
    const event: ChecklistDeletedEvent = {
      type: 'checklist.deleted',
      tenantId: args.tenantId,
      issueId: args.issueId,
      checklistId: args.checklistId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  publishChecklistItemCreated(args: {
    tenantId: string;
    issueId: string;
    checklistId: string;
    item: ChecklistItemResponseDto;
  }): void {
    const event: ChecklistItemCreatedEvent = {
      type: 'checklist_item.created',
      tenantId: args.tenantId,
      issueId: args.issueId,
      checklistId: args.checklistId,
      item: args.item,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  publishChecklistItemUpdated(args: {
    tenantId: string;
    issueId: string;
    checklistId: string;
    item: ChecklistItemResponseDto;
  }): void {
    const event: ChecklistItemUpdatedEvent = {
      type: 'checklist_item.updated',
      tenantId: args.tenantId,
      issueId: args.issueId,
      checklistId: args.checklistId,
      item: args.item,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  publishChecklistItemDeleted(args: {
    tenantId: string;
    issueId: string;
    checklistId: string;
    itemId: string;
  }): void {
    const event: ChecklistItemDeletedEvent = {
      type: 'checklist_item.deleted',
      tenantId: args.tenantId,
      issueId: args.issueId,
      checklistId: args.checklistId,
      itemId: args.itemId,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  publishIssueChecklistProgressChanged(args: {
    tenantId: string;
    projectId: string;
    issueId: string;
    total: number;
    done: number;
  }): void {
    const event: IssueChecklistProgressChangedEvent = {
      type: 'issue.checklist_progress_changed',
      tenantId: args.tenantId,
      projectId: args.projectId,
      issueId: args.issueId,
      total: args.total,
      done: args.done,
      timestamp: new Date().toISOString(),
    };
    this.safeEmit(event, [
      this.gateway.tenantRoom(args.tenantId),
      this.gateway.projectRoom(args.projectId),
      this.gateway.issueRoom(args.issueId),
    ]);
  }

  // ── internal ──────────────────────────────────────────────────────────

  /**
   * Emit event без выбрасывания исключений. Любая ошибка → лог, бизнес-
   * транзакция не страдает (UI просто не получит live-обновление,
   * фронт всё равно повторно загрузит данные).
   */
  private safeEmit(event: TrackerWsEvent, rooms: string[]): void {
    try {
      // Имя event'а = тип (для on('issue.created', …) клиента).
      this.gateway.emitToRooms(rooms, event.type, event);
    } catch (e) {
      this.logger.warn(
        {
          type: event.type,
          tenantId: event.tenantId,
          err: e instanceof Error ? e.message : String(e),
        },
        'tracker WS emit failed',
      );
    }
  }
}
