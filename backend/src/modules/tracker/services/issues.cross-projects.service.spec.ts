import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ListOrgIssuesQuery } from '../dto/issues/list-org-issues-query.dto';

import type { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';
import type { ProjectsService } from './projects.service';
import type { TrackerEmitterService } from './tracker-emitter.service';
import type { TrackerEventsService } from './tracker-events.service';
import type { WebhookDispatcher } from './webhook-dispatcher.service';

/**
 * Unit-тесты `IssuesService.findAllAcrossProjects` (сквозной список задач org,
 * `GET /api/v1/issues`). Mocked Prisma + остальные сервисы.
 *
 * Покрываем видимость Р3/Р4:
 *   1. руководитель видит всё (нет self-scope AND), фильтр assigneeUserId учитывается.
 *   2. manager+strict — только свои+созданные (assigneeUserId игнорируется).
 *   3. manager+open — видит всё.
 *   4. stateCategory протекает в item ответа (null при state=null).
 *   5. projectId фильтр.
 *   6. q + strict не затирают друг друга (OR поиска + AND self-scope сосуществуют).
 *   7. stateCategory фильтр в where.
 *   8. tenant-scope.
 */

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
  boardId: string | null;
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
  checklistTotalCount: number;
  checklistDoneCount: number;
  assignees: Array<{ userId: string }>;
  labels: Array<{ labelId: string }>;
  state: { category: string } | null;
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
    boardId: null,
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
    checklistTotalCount: 0,
    checklistDoneCount: 0,
    assignees: [{ userId: 'me' }],
    labels: [],
    state: { category: 'unstarted' },
    ...overrides,
  };
}

function makeService(rows: FakeIssueRow[]): {
  svc: IssuesService;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  const count = vi.fn(async () => rows.length);
  const prisma = {
    issue: { findMany, count },
  } as unknown as PrismaService;
  // Остальные зависимости IssuesService — null-like, findAllAcrossProjects их не дергает.
  const svc = new IssuesService(
    prisma,
    {} as ActivityRecorderService,
    {} as ProjectsService,
    {} as TrackerEventsService,
    {} as WebhookDispatcher,
    {} as TrackerEmitterService,
  );
  return { svc, findMany, count };
}

const baseQuery: ListOrgIssuesQuery = {
  includeArchived: false,
  includeDeleted: false,
  includeChildrenCount: false,
  page: 1,
  limit: 100,
};

type WhereShape = Record<string, unknown>;

function whereOf(findMany: ReturnType<typeof vi.fn>): WhereShape {
  const call = findMany.mock.calls[0]?.[0] as { where: WhereShape };
  return call.where;
}

describe('IssuesService.findAllAcrossProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('руководитель видит всё (нет self-scope AND); assigneeUserId учитывается', async () => {
    const { svc, findMany } = makeService([makeRow('a')]);
    await svc.findAllAcrossProjects(
      't1',
      'me',
      { ...baseQuery, assigneeUserId: 'u2' },
      { isLeadership: true, visibility: 'strict' },
    );
    const where = whereOf(findMany);
    expect(where.AND).toBeUndefined();
    expect(where.assignees).toEqual({ some: { userId: 'u2' } });
  });

  it('manager+strict — только свои+созданные; чужой assigneeUserId игнорируется', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAllAcrossProjects(
      't1',
      'me',
      { ...baseQuery, assigneeUserId: 'someone-else' },
      { isLeadership: false, visibility: 'strict' },
    );
    const where = whereOf(findMany);
    expect(where.AND).toEqual([
      {
        OR: [
          { assignees: { some: { userId: 'me' } } },
          { createdById: 'me' },
        ],
      },
    ]);
    // assigneeUserId по чужому НЕ выставлен (нельзя подсмотреть чужое).
    expect(where.assignees).toBeUndefined();
  });

  it('manager+open — видит всё (нет self-scope AND)', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAllAcrossProjects(
      't1',
      'me',
      baseQuery,
      { isLeadership: false, visibility: 'open' },
    );
    const where = whereOf(findMany);
    expect(where.AND).toBeUndefined();
  });

  it('stateCategory протекает в item ответа (started); state=null → null', async () => {
    const { svc } = makeService([
      makeRow('a', { state: { category: 'started' } }),
      makeRow('b', { state: null }),
    ]);
    const result = await svc.findAllAcrossProjects(
      't1',
      'me',
      baseQuery,
      { isLeadership: true, visibility: 'strict' },
    );
    expect(result.items[0]?.stateCategory).toBe('started');
    expect(result.items[1]?.stateCategory).toBeNull();
  });

  it('projectId фильтр попадает в where', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAllAcrossProjects(
      't1',
      'me',
      { ...baseQuery, projectId: 'p9' },
      { isLeadership: true, visibility: 'open' },
    );
    expect(whereOf(findMany).projectId).toBe('p9');
  });

  it('q + strict сосуществуют: where.OR (поиск) и where.AND (self-scope) оба присутствуют', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAllAcrossProjects(
      't1',
      'me',
      { ...baseQuery, q: 'абв' },
      { isLeadership: false, visibility: 'strict' },
    );
    const where = whereOf(findMany);
    expect(where.OR).toEqual([
      { title: { contains: 'абв', mode: 'insensitive' } },
      { descriptionStripped: { contains: 'абв', mode: 'insensitive' } },
      { identifier: { contains: 'абв', mode: 'insensitive' } },
    ]);
    expect(where.AND).toEqual([
      {
        OR: [
          { assignees: { some: { userId: 'me' } } },
          { createdById: 'me' },
        ],
      },
    ]);
  });

  it('stateCategory фильтр → where.state = { category }', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAllAcrossProjects(
      't1',
      'me',
      { ...baseQuery, stateCategory: 'started' },
      { isLeadership: true, visibility: 'open' },
    );
    expect(whereOf(findMany).state).toEqual({ category: 'started' });
  });

  it('tenant-scope: where.tenantId равен переданному', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAllAcrossProjects(
      't-other',
      'me',
      baseQuery,
      { isLeadership: true, visibility: 'open' },
    );
    expect(whereOf(findMany).tenantId).toBe('t-other');
  });
});
