import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IssueResponseDto } from '../dto/issues/issue-response.dto';
import type { TrackerGateway } from '../gateways/tracker.gateway';

import type { CommentResponseDto } from './comments.service';
import { TrackerEventsService } from './tracker-events.service';

describe('TrackerEventsService', () => {
  let emitToRooms: ReturnType<typeof vi.fn>;
  let gateway: TrackerGateway;
  let svc: TrackerEventsService;

  beforeEach(() => {
    emitToRooms = vi.fn();
    gateway = {
      tenantRoom: (t: string) => `tenant:${t}`,
      projectRoom: (p: string) => `project:${p}`,
      issueRoom: (i: string) => `issue:${i}`,
      emitToRooms,
    } as unknown as TrackerGateway;
    svc = new TrackerEventsService(gateway);
  });

  function makeIssue(id = 'i1', projectId = 'p1'): IssueResponseDto {
    return {
      id,
      tenantId: 't1',
      projectId,
      identifier: 'KORA-1',
      sequenceId: 1,
      title: 'Test',
      description: null,
      descriptionHtml: null,
      descriptionStripped: null,
      priority: 'medium',
      stateId: null,
      parentId: null,
      estimatePoints: null,
      sortOrder: 0,
      startDate: null,
      dueDate: null,
      completedAt: null,
      cycleId: null,
      goalId: null,
      boardId: null,
      meetingId: null,
      linkedMeetingIds: [],
      sourceBlockIds: [],
      confidence: null,
      createdManually: true,
      externalSource: null,
      externalId: null,
      entityId: null,
      createdById: 'u1',
      createdAt: '2026-05-24T10:00:00Z',
      updatedAt: '2026-05-24T10:00:00Z',
      archivedAt: null,
      deletedAt: null,
      assigneeUserIds: [],
      labelIds: [],
      checklistTotalCount: 0,
      checklistDoneCount: 0,
    };
  }

  it('publishIssueCreated — emit в tenant + project rooms', () => {
    const issue = makeIssue();
    svc.publishIssueCreated(issue, 't1');
    expect(emitToRooms).toHaveBeenCalledTimes(1);
    const [rooms, name, payload] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['tenant:t1', 'project:p1']);
    expect(name).toBe('issue.created');
    expect(payload.type).toBe('issue.created');
    expect(payload.issue.id).toBe('i1');
    expect(payload.tenantId).toBe('t1');
    expect(payload.projectId).toBe('p1');
    expect(typeof payload.timestamp).toBe('string');
  });

  it('publishIssueUpdated — emit во все три rooms + changedFields', () => {
    svc.publishIssueUpdated(makeIssue('i2', 'p1'), 't1', ['title', 'stateId']);
    const [rooms, name, payload] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['tenant:t1', 'project:p1', 'issue:i2']);
    expect(name).toBe('issue.updated');
    expect(payload.changedFields).toEqual(['title', 'stateId']);
  });

  it('publishIssueDeleted — emit во все три rooms по id', () => {
    svc.publishIssueDeleted('i9', 't1', 'p7');
    const [rooms, name, payload] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['tenant:t1', 'project:p7', 'issue:i9']);
    expect(name).toBe('issue.deleted');
    expect(payload.issueId).toBe('i9');
  });

  it('publishCommentCreated — emit в tenant + issue rooms', () => {
    const comment: CommentResponseDto = {
      id: 'c1',
      issueId: 'i1',
      authorId: 'u1',
      parentCommentId: null,
      content: 'hi',
      contentHtml: null,
      contentStripped: 'hi',
      access: 'public',
      voiceUrl: null,
      voiceDuration: null,
      voiceTranscript: null,
      mentionedUserIds: [],
      createdAt: '2026-05-24T10:00:00Z',
      editedAt: null,
      deletedAt: null,
    };
    svc.publishCommentCreated(comment, 't1');
    const [rooms, name] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['tenant:t1', 'issue:i1']);
    expect(name).toBe('comment.created');
  });

  it('safe — ошибка в emit не пропагируется (бизнес-транзакция не страдает)', () => {
    emitToRooms.mockImplementation(() => {
      throw new Error('socket boom');
    });
    expect(() => svc.publishIssueCreated(makeIssue(), 't1')).not.toThrow();
  });
});
