import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { TrackerEventPayload } from '../tracker/services/tracker-emitter.service';

import type { ConversationalService } from './conversational.service';
import { IssueAssignmentNotifierService } from './issue-assignment-notifier.service';

function makePayload(overrides: Partial<TrackerEventPayload> = {}): TrackerEventPayload {
  return {
    type: 'issue.assignee_changed',
    tenantId: 'org_1',
    occurredAt: '2026-06-20T00:00:00.000Z',
    issue: {
      id: 'issue_1',
      identifier: 'INB-5',
      title: 'Протестировать бота',
      projectId: 'proj_1',
      stateId: null,
      dueDate: '2026-06-20T00:00:00.000Z',
    },
    actor: { userId: 'actor_1', actorType: 'user' },
    meta: { action: 'added', assigneeUserId: 'assignee_1' },
    ...overrides,
  };
}

describe('IssueAssignmentNotifierService', () => {
  let sendNotification: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let service: IssueAssignmentNotifierService;
  let enabled: boolean;

  beforeEach(() => {
    enabled = true;
    sendNotification = vi.fn(async () => ({}));
    userFindUnique = vi.fn(async () => ({ name: 'Настя' }));
    const cfg = {
      get tracker() {
        return { assignmentNotificationsEnabled: enabled };
      },
    } as unknown as TypedConfigService;
    const prisma = { user: { findUnique: userFindUnique } } as unknown as PrismaService;
    const conversational = { sendNotification } as unknown as ConversationalService;
    service = new IssueAssignmentNotifierService(cfg, prisma, conversational);
  });

  it('added + assignee≠actor → 1 sendNotification(issue.assigned, internal, recipient=assignee)', async () => {
    await service.onTrackerEvent(makePayload());
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'issue.assigned',
        recipientUserId: 'assignee_1',
        dataClass: 'internal',
        payload: expect.objectContaining({
          byName: 'Настя',
          issueTitle: 'Протестировать бота',
          issueIdentifier: 'INB-5',
          dueDate: '2026-06-20',
          byUserId: 'actor_1',
        }),
      }),
    );
  });

  it('self: assignee == actor → 0', async () => {
    await service.onTrackerEvent(makePayload({ meta: { action: 'added', assigneeUserId: 'actor_1' } }));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('action removed → 0', async () => {
    await service.onTrackerEvent(makePayload({ meta: { action: 'removed', assigneeUserId: 'assignee_1' } }));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('тип не issue.assignee_changed → 0', async () => {
    await service.onTrackerEvent(makePayload({ type: 'issue.created' }));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('kill-switch OFF → 0', async () => {
    enabled = false;
    await service.onTrackerEvent(makePayload());
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
