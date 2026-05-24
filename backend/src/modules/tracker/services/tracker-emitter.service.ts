import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Issue, IssueState } from '@prisma/client';

import type { CommentResponseDto } from './comments.service';

/**
 * Типы событий трекера, эмитируемые в шину `tracker.event_occurred`.
 * TrackerAdapter (в IngestModule) маппит каждый на signalType из enum
 * SignalType (task_*).
 *
 * NB: `issue.updated` (общий) НЕ эмитим — слишком шумно. Только специфичные
 * изменения: status_changed_to_blocked / status_changed_to_done /
 * assignee_changed.
 */
export type TrackerEventType =
  | 'issue.created'
  | 'issue.status_changed'
  | 'issue.status_changed_to_blocked'
  | 'issue.status_changed_to_done'
  | 'issue.overdue_detected'
  | 'issue.assignee_changed'
  | 'comment.created'
  | 'mention.created';

/**
 * Универсальный payload события трекера. Передаётся «как есть» в
 * `TrackerAdapter` (модуль `ingest`). Все поля сериализуемы в JSON.
 */
export interface TrackerEventPayload {
  type: TrackerEventType;
  tenantId: string;
  /** Когда событие произошло (для оконных дедупов). ISO либо Date.toISOString(). */
  occurredAt: string;
  /** Базовые данные задачи — общие для всех событий. */
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    projectId: string;
    stateId?: string | null;
    dueDate?: string | null;
  };
  /** Кто инициировал событие (`user` | `ai_agent` | `system` cron). */
  actor: {
    userId: string | null;
    actorType: 'user' | 'ai_agent' | 'system';
  };
  /** Специфика по типу события. */
  meta?: Record<string, unknown>;
}

/**
 * TrackerEmitterService — единая точка публикации событий трекера в
 * `tracker.event_occurred`. Слушатель — `TrackerAdapter` (IngestModule)
 * через `@OnEvent`.
 *
 * Sprint 3 B1-3.1 (2026-05-24). Реализует принцип «трекер = источник для
 * второго мозга»: каждая значимая мутация Issue/Comment эмитится в шину,
 * TrackerAdapter формирует RawEvent → block-ingest worker → IdeaBlock.
 *
 * Все методы fire-and-forget (EventEmitter2 синхронный по дефолту, но
 * слушатели в IngestModule помечены `{ async: true }`). Ошибки слушателей
 * не пробрасываются — бизнес-транзакция Tracker'а никогда не падает из-за
 * проблем ingest'а.
 */
@Injectable()
export class TrackerEmitterService {
  private readonly logger = new Logger(TrackerEmitterService.name);

  static readonly EVENT_NAME = 'tracker.event_occurred';

  constructor(
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  emitIssueCreated(issue: Issue, actorUserId: string): void {
    this.emit({
      type: 'issue.created',
      tenantId: issue.tenantId,
      occurredAt: (issue.createdAt ?? new Date()).toISOString(),
      issue: this.basicIssue(issue),
      actor: { userId: actorUserId, actorType: 'user' },
      meta: {
        description: issue.description ?? null,
        priority: issue.priority,
      },
    });
  }

  emitIssueStatusChanged(args: {
    issue: Issue;
    actorUserId: string;
    oldStateId: string | null;
    newStateId: string | null;
    oldStateCategory: string | null;
    newStateCategory: string | null;
    reason?: string | null;
  }): void {
    this.emit({
      type: 'issue.status_changed',
      tenantId: args.issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: this.basicIssue(args.issue),
      actor: { userId: args.actorUserId, actorType: 'user' },
      meta: {
        oldStateId: args.oldStateId,
        newStateId: args.newStateId,
        oldStateCategory: args.oldStateCategory,
        newStateCategory: args.newStateCategory,
        reason: args.reason ?? null,
      },
    });
  }

  emitIssueBlocked(args: {
    issue: Issue;
    actorUserId: string;
    newState: Pick<IssueState, 'id' | 'name' | 'category'>;
    reason?: string | null;
  }): void {
    this.emit({
      type: 'issue.status_changed_to_blocked',
      tenantId: args.issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: this.basicIssue(args.issue),
      actor: { userId: args.actorUserId, actorType: 'user' },
      meta: {
        newStateId: args.newState.id,
        newStateName: args.newState.name,
        newStateCategory: args.newState.category,
        reason: args.reason ?? null,
      },
    });
  }

  emitIssueCompleted(args: {
    issue: Issue;
    actorUserId: string;
    newState: Pick<IssueState, 'id' | 'name' | 'category'>;
  }): void {
    this.emit({
      type: 'issue.status_changed_to_done',
      tenantId: args.issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: this.basicIssue(args.issue),
      actor: { userId: args.actorUserId, actorType: 'user' },
      meta: {
        newStateId: args.newState.id,
        newStateName: args.newState.name,
        newStateCategory: args.newState.category,
      },
    });
  }

  emitIssueAssigneeChanged(args: {
    issue: Issue;
    actorUserId: string;
    action: 'added' | 'removed';
    assigneeUserId: string;
  }): void {
    this.emit({
      type: 'issue.assignee_changed',
      tenantId: args.issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: this.basicIssue(args.issue),
      actor: { userId: args.actorUserId, actorType: 'user' },
      meta: {
        action: args.action,
        assigneeUserId: args.assigneeUserId,
      },
    });
  }

  emitIssueOverdueDetected(args: {
    issue: Issue;
    /** Сколько дней просрочена (рассчитывается крон-ом). */
    daysOverdue: number;
  }): void {
    this.emit({
      type: 'issue.overdue_detected',
      tenantId: args.issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: this.basicIssue(args.issue),
      actor: { userId: null, actorType: 'system' },
      meta: {
        daysOverdue: args.daysOverdue,
        dueDate: args.issue.dueDate?.toISOString() ?? null,
      },
    });
  }

  emitCommentCreated(args: {
    issue: Issue;
    comment: CommentResponseDto;
    actorUserId: string;
  }): void {
    this.emit({
      type: 'comment.created',
      tenantId: args.issue.tenantId,
      occurredAt: args.comment.createdAt,
      issue: this.basicIssue(args.issue),
      actor: { userId: args.actorUserId, actorType: 'user' },
      meta: {
        commentId: args.comment.id,
        commentContent: args.comment.content,
        commentStripped: args.comment.contentStripped,
        parentCommentId: args.comment.parentCommentId,
        mentionedUserIds: args.comment.mentionedUserIds,
        voiceTranscript: args.comment.voiceTranscript,
      },
    });
  }

  emitMentionCreated(args: {
    issue: Issue;
    actorUserId: string;
    mentionedUserId: string;
    commentId: string | null;
    /** Контекст: текст комментария / задачи, в котором было упоминание. */
    contextText: string | null;
  }): void {
    this.emit({
      type: 'mention.created',
      tenantId: args.issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: this.basicIssue(args.issue),
      actor: { userId: args.actorUserId, actorType: 'user' },
      meta: {
        mentionedUserId: args.mentionedUserId,
        commentId: args.commentId,
        contextText: args.contextText,
      },
    });
  }

  // ── internal ──

  private emit(payload: TrackerEventPayload): void {
    try {
      this.eventEmitter.emit(TrackerEmitterService.EVENT_NAME, payload);
    } catch (err) {
      // EventEmitter2.emit бросает только для wildcard-listener'ов; всё равно
      // ловим — бизнес-транзакция не должна падать из-за ingest'а.
      this.logger.warn(
        {
          type: payload.type,
          issueId: payload.issue.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'tracker-emitter: emit упал — событие потеряно',
      );
    }
  }

  private basicIssue(issue: Issue): TrackerEventPayload['issue'] {
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? null,
      projectId: issue.projectId,
      stateId: issue.stateId,
      dueDate: issue.dueDate?.toISOString() ?? null,
    };
  }
}
