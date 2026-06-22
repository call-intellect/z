import type { Issue } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { TrackerEmitterService } from '../services/tracker-emitter.service';

import { IssueOverdueDetectorCron } from './issue-overdue-detector.cron';

describe('IssueOverdueDetectorCron', () => {
  let prisma: PrismaService;
  let emitter: TrackerEmitterService;
  let conversational: ConversationalService;
  let cfg: TypedConfigService;
  let cron: IssueOverdueDetectorCron;

  let issueFindMany: ReturnType<typeof vi.fn>;
  let issueUpdate: ReturnType<typeof vi.fn>;
  let assigneeFindMany: ReturnType<typeof vi.fn>;
  let emitOverdue: ReturnType<typeof vi.fn>;
  let sendNotification: ReturnType<typeof vi.fn>;

  let overdueNotifyEnabled = true;

  const overdueIssue: Issue = {
    id: 'i1',
    tenantId: 'org_1',
    projectId: 'p1',
    identifier: 'KORA-1',
    sequenceId: 1,
    title: 'Просроченная задача',
    description: null,
    descriptionHtml: null,
    descriptionStripped: null,
    priority: 'medium',
    stateId: 's1',
    parentId: null,
    estimatePoints: null,
    sortOrder: 0,
    startDate: null,
    dueDate: new Date('2026-05-01T00:00:00Z'),
    completedAt: null,
    lastOverdueDetectedAt: null,
    cycleId: null,
    goalId: null,
    meetingId: null,
    linkedMeetingIds: [],
    sourceBlockIds: [],
    confidence: null,
    createdManually: true,
    externalSource: null,
    externalId: null,
    entityId: null,
    createdById: 'u1',
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    archivedAt: null,
    deletedAt: null,
  } as unknown as Issue;

  beforeEach(() => {
    overdueNotifyEnabled = true;
    issueFindMany = vi.fn().mockResolvedValue([overdueIssue]);
    issueUpdate = vi.fn().mockResolvedValue(overdueIssue);
    assigneeFindMany = vi.fn().mockResolvedValue([{ userId: 'u-assignee' }]);
    emitOverdue = vi.fn();
    sendNotification = vi.fn().mockResolvedValue(undefined);
    prisma = {
      issue: { findMany: issueFindMany, update: issueUpdate },
      issueAssignee: { findMany: assigneeFindMany },
    } as unknown as PrismaService;
    emitter = {
      emitIssueOverdueDetected: emitOverdue,
    } as unknown as TrackerEmitterService;
    conversational = {
      sendNotification,
    } as unknown as ConversationalService;
    cfg = {
      get tracker() {
        return { overdueNotifyEnabled };
      },
    } as unknown as TypedConfigService;
    cron = new IssueOverdueDetectorCron(prisma, emitter, conversational, cfg);
  });

  it('эмитит overdue + проставляет lastOverdueDetectedAt для каждой просроченной задачи', async () => {
    const result = await cron.run();
    expect(result).toEqual({ scanned: 1, emitted: 1 });
    expect(emitOverdue).toHaveBeenCalledTimes(1);
    const call = emitOverdue.mock.calls[0]![0];
    expect(call.issue.id).toBe('i1');
    expect(call.daysOverdue).toBeGreaterThanOrEqual(1);
    expect(issueUpdate).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ lastOverdueDetectedAt: expect.any(Date) }),
    });
  });

  it('фильтрует по dueDate < now + state.category NOT IN completed/cancelled + дедуп 7d', async () => {
    await cron.run();
    expect(issueFindMany).toHaveBeenCalledTimes(1);
    const where = issueFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.deletedAt).toBeNull();
    expect(where.dueDate).toEqual({ lt: expect.any(Date) });
    expect(where.OR).toEqual([
      { lastOverdueDetectedAt: null },
      { lastOverdueDetectedAt: { lt: expect.any(Date) } },
    ]);
    expect(where.state).toEqual({
      category: { notIn: ['completed', 'cancelled'] },
    });
  });

  it('пропускает задачу без dueDate (защита)', async () => {
    issueFindMany.mockResolvedValueOnce([{ ...overdueIssue, dueDate: null }]);
    const result = await cron.run();
    expect(result.emitted).toBe(0);
    expect(emitOverdue).not.toHaveBeenCalled();
  });

  it('ошибка emit/update одной задачи не валит обработку остальных', async () => {
    issueFindMany.mockResolvedValueOnce([overdueIssue, { ...overdueIssue, id: 'i2' }]);
    issueUpdate.mockRejectedValueOnce(new Error('boom'));
    const result = await cron.run();
    expect(result.scanned).toBe(2);
    expect(result.emitted).toBe(1);
    expect(emitOverdue).toHaveBeenCalledTimes(2);
  });

  it('просроченная задача с assignee → шлёт issue.overdue исполнителю + дедуп', async () => {
    const result = await cron.run();
    expect(result).toEqual({ scanned: 1, emitted: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const arg = sendNotification.mock.calls[0]![0];
    expect(arg.eventType).toBe('issue.overdue');
    expect(arg.recipientUserId).toBe('u-assignee');
    expect(arg.tenantId).toBe('org_1');
    expect(arg.dataClass).toBe('internal');
    expect(arg.payload.issueId).toBe('i1');
    expect(arg.payload.issueIdentifier).toBe('KORA-1');
    expect(arg.payload.actionUrl).toBe('/issues/i1');
    expect(issueUpdate).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ lastOverdueDetectedAt: expect.any(Date) }),
    });
  });

  it('overdueNotifyEnabled:false → sendNotification не вызван, но дедуп проставлен', async () => {
    overdueNotifyEnabled = false;
    const result = await cron.run();
    expect(result.emitted).toBe(1);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(assigneeFindMany).not.toHaveBeenCalled();
    expect(issueUpdate).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ lastOverdueDetectedAt: expect.any(Date) }),
    });
  });

  it('sendNotification бросает → крон не падает, дедуп проставлен', async () => {
    sendNotification.mockRejectedValueOnce(new Error('boom'));
    const result = await cron.run();
    expect(result).toEqual({ scanned: 1, emitted: 1 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(issueUpdate).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ lastOverdueDetectedAt: expect.any(Date) }),
    });
  });

  it('задача без assignees → sendNotification не вызван, дедуп проставлен', async () => {
    assigneeFindMany.mockResolvedValueOnce([]);
    const result = await cron.run();
    expect(result.emitted).toBe(1);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(issueUpdate).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ lastOverdueDetectedAt: expect.any(Date) }),
    });
  });
});
