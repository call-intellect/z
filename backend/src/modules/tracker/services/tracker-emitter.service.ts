import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Issue, IssueState } from '@prisma/client';

import type { CommentResponseDto } from './comments.service';

export type TrackerEventType =
  | 'issue.created'
  | 'issue.status_changed'
  | 'issue.status_changed_to_blocked'
  | 'issue.status_changed_to_done'
  | 'issue.overdue_detected'
  | 'issue.assignee_changed'
  | 'comment.created'
  | 'mention.created';

export interface TrackerEventPayload {
  type: TrackerEventType;
  tenantId: string;
  occurredAt: string;
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    projectId: string;
    stateId?: string | null;
    dueDate?: string | null;
  };
  actor: {
    userId: string | null;
    actorType: 'user' | 'ai_agent' | 'system';
  };
  meta?: Record<string, unknown>;
}

@Injectable()
export class TrackerEmitterService {
  private readonly logger = new Logger(TrackerEmitterService.name);

  static readonly EVENT_NAME = 'tracker.event_occurred';
  static readonly PROJECT_DOCUMENT_EVENT_NAME = 'tracker.project_document_changed';

  constructor(@Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2) {}

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

  emitIssueOverdueDetected(args: { issue: Issue; daysOverdue: number }): void {
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

  emitProjectDocumentChanged(args: {
    tenantId: string;
    projectId: string;
    documentId: string;
    title: string;
    fullText: string | null;
    actorUserId: string | null;
    occurredAt: Date;
    changeType: 'created' | 'updated';
  }): void {
    try {
      this.eventEmitter.emit(TrackerEmitterService.PROJECT_DOCUMENT_EVENT_NAME, {
        type: 'project_document.changed',
        tenantId: args.tenantId,
        projectId: args.projectId,
        documentId: args.documentId,
        title: args.title,
        fullText: args.fullText,
        actor: {
          userId: args.actorUserId,
          actorType: args.actorUserId ? 'user' : 'system',
        },
        occurredAt: args.occurredAt.toISOString(),
        changeType: args.changeType,
      });
    } catch (err) {
      this.logger.warn(
        {
          documentId: args.documentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'tracker-emitter: project-document emit упал — событие потеряно',
      );
    }
  }

  private emit(payload: TrackerEventPayload): void {
    try {
      this.eventEmitter.emit(TrackerEmitterService.EVENT_NAME, payload);
    } catch (err) {
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
