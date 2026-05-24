import type { Issue } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { TrackerEmitterService } from '../services/tracker-emitter.service';

import { IssueOverdueDetectorCron } from './issue-overdue-detector.cron';

describe('IssueOverdueDetectorCron', () => {
  let prisma: PrismaService;
  let emitter: TrackerEmitterService;
  let cron: IssueOverdueDetectorCron;

  let issueFindMany: ReturnType<typeof vi.fn>;
  let issueUpdate: ReturnType<typeof vi.fn>;
  let emitOverdue: ReturnType<typeof vi.fn>;

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
    issueFindMany = vi.fn().mockResolvedValue([overdueIssue]);
    issueUpdate = vi.fn().mockResolvedValue(overdueIssue);
    emitOverdue = vi.fn();
    prisma = {
      issue: { findMany: issueFindMany, update: issueUpdate },
    } as unknown as PrismaService;
    emitter = {
      emitIssueOverdueDetected: emitOverdue,
    } as unknown as TrackerEmitterService;
    cron = new IssueOverdueDetectorCron(prisma, emitter);
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
    issueFindMany.mockResolvedValueOnce([
      overdueIssue,
      { ...overdueIssue, id: 'i2' },
    ]);
    issueUpdate.mockRejectedValueOnce(new Error('boom'));
    const result = await cron.run();
    expect(result.scanned).toBe(2);
    expect(result.emitted).toBe(1); // первая упала, вторая прошла
    expect(emitOverdue).toHaveBeenCalledTimes(2);
  });
});
