import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MyInboxQuery } from '../dto/issues/my-inbox-query.dto';

import type { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';
import type { ProjectsService } from './projects.service';
import type { TrackerEmitterService } from './tracker-emitter.service';
import type { TrackerEventsService } from './tracker-events.service';
import type { WebhookDispatcher } from './webhook-dispatcher.service';

interface FakeIssueRow {
  id: string;
  tenantId: string;
  projectId: string;
  identifier: string;
  sequenceId: number;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  descriptionStripped: string | null;
  priority: string;
  stateId: string | null;
  parentId: string | null;
  estimatePoints: number | null;
  sortOrder: number;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  cycleId: string | null;
  goalId: string | null;
  meetingId: string | null;
  linkedMeetingIds: string[];
  sourceBlockIds: string[];
  confidence: { toString: () => string } | null;
  createdManually: boolean;
  externalSource: string | null;
  externalId: string | null;
  entityId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
  assignees: Array<{ userId: string }>;
  labels: Array<{ labelId: string }>;
}

function makeRow(id: string, overrides: Partial<FakeIssueRow> = {}): FakeIssueRow {
  return {
    id,
    tenantId: 't1',
    projectId: 'p1',
    identifier: `KORA-${id}`,
    sequenceId: 1,
    title: `Issue ${id}`,
    description: null,
    descriptionHtml: null,
    descriptionStripped: null,
    priority: 'none',
    stateId: null,
    parentId: null,
    estimatePoints: null,
    sortOrder: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
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
    createdById: 'creator-1',
    createdAt: new Date('2026-05-20T10:00:00Z'),
    updatedAt: new Date('2026-05-20T10:00:00Z'),
    archivedAt: null,
    deletedAt: null,
    assignees: [{ userId: 'me' }],
    labels: [],
    ...overrides,
  };
}

function makeService(rows: FakeIssueRow[]): {
  svc: IssuesService;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  const prisma = {
    issue: { findMany },
  } as unknown as PrismaService;
  const svc = new IssuesService(
    prisma,
    {} as ActivityRecorderService,
    {} as ProjectsService,
    {} as TrackerEventsService,
    {} as WebhookDispatcher,
    {} as TrackerEmitterService,
  );
  return { svc, findMany };
}

const baseQuery: MyInboxQuery = {
  includeArchived: false,
  includeDeleted: false,
  limit: 50,
};

describe('IssuesService.findMyInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('фильтрует по assignee=userId через relation IssueAssignee', async () => {
    const { svc, findMany } = makeService([makeRow('a')]);
    const result = await svc.findMyInbox('t1', 'me', baseQuery);

    expect(findMany).toHaveBeenCalledTimes(1);
    const call = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.tenantId).toBe('t1');
    expect(call.where.assignees).toEqual({ some: { userId: 'me' } });
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.archivedAt).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('a');
    expect(result.items[0]?.assigneeUserIds).toEqual(['me']);
  });

  it('фильтры stateCategory + projectId + labelId + cycleId + dueBefore попадают в where', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findMyInbox('t1', 'me', {
      ...baseQuery,
      stateCategory: 'started',
      projectId: 'p99',
      labelId: 'l1',
      cycleId: 'c1',
      priority: 'high',
      dueBefore: new Date('2026-06-01T00:00:00Z'),
    });
    const call = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.projectId).toBe('p99');
    expect(call.where.cycleId).toBe('c1');
    expect(call.where.priority).toBe('high');
    expect(call.where.state).toEqual({ category: 'started' });
    expect(call.where.labels).toEqual({ some: { labelId: 'l1' } });
    expect(call.where.dueDate).toEqual({ lte: new Date('2026-06-01T00:00:00Z') });
  });

  it('пагинация: limit=2, есть 3 задачи → возвращает 2 + nextCursor=id последней', async () => {
    const rows = [makeRow('z'), makeRow('y'), makeRow('x')];
    const { svc, findMany } = makeService(rows);
    const result = await svc.findMyInbox('t1', 'me', { ...baseQuery, limit: 2 });

    const call = findMany.mock.calls[0]?.[0] as { take: number };
    expect(call.take).toBe(3);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(['z', 'y']);
    expect(result.nextCursor).toBe('y');
    expect(result.limit).toBe(2);
  });

  it('пагинация: если задач ≤ limit → nextCursor=null', async () => {
    const rows = [makeRow('z'), makeRow('y')];
    const { svc } = makeService(rows);
    const result = await svc.findMyInbox('t1', 'me', { ...baseQuery, limit: 5 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('cursor: передаёт where.id={lt: cursor} для следующей страницы', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findMyInbox('t1', 'me', { ...baseQuery, cursor: 'last-seen-id' });
    const call = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.id).toEqual({ lt: 'last-seen-id' });
  });

  it('tenant isolation: вызов с другим tenantId — другой where.tenantId', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findMyInbox('t-other', 'me', baseQuery);
    const call = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.tenantId).toBe('t-other');
  });

  it('includeDeleted=true + includeArchived=true — не подмешивает null-фильтры', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findMyInbox('t1', 'me', {
      ...baseQuery,
      includeDeleted: true,
      includeArchived: true,
    });
    const call = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty('deletedAt');
    expect(call.where).not.toHaveProperty('archivedAt');
  });
});
