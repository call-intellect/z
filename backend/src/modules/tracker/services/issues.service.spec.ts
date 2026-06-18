import type { Issue } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateIssueDto } from '../dto/issues/create-issue.dto';
import type { UpdateIssueDto } from '../dto/issues/update-issue.dto';

import type { ActivityRecorderService } from './activity-recorder.service';
import type { HolidayService } from './holiday.service';
import { IssuesService } from './issues.service';
import type { ProjectsService } from './projects.service';
import type { TrackerEmitterService } from './tracker-emitter.service';
import type { TrackerEventsService } from './tracker-events.service';
import type { WebhookDispatcher } from './webhook-dispatcher.service';

describe('IssuesService — HolidayService integration', () => {
  const SATURDAY = new Date(Date.UTC(2026, 0, 3));
  const MONDAY = new Date(Date.UTC(2026, 0, 5));

  let prisma: PrismaService;
  let activity: ActivityRecorderService;
  let projects: ProjectsService;
  let events: TrackerEventsService;
  let webhooks: WebhookDispatcher;
  let emitter: TrackerEmitterService;
  let holiday: HolidayService;
  let service: IssuesService;

  let issueCreate: ReturnType<typeof vi.fn>;
  let issueUpdate: ReturnType<typeof vi.fn>;
  let issueFindFirst: ReturnType<typeof vi.fn>;
  let issueAggregate: ReturnType<typeof vi.fn>;
  let adjustDueDate: ReturnType<typeof vi.fn>;

  const baseProject = {
    id: 'p1',
    tenantId: 'org_1',
    identifier: 'KORA',
    defaultStateId: null,
  };

  const baseIssue: Issue = {
    id: 'i1',
    tenantId: 'org_1',
    projectId: 'p1',
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    deletedAt: null,
  } as unknown as Issue;

  beforeEach(() => {
    issueCreate = vi.fn().mockImplementation(async ({ data }) => ({
      ...baseIssue,
      ...data,
    }));
    issueUpdate = vi.fn().mockResolvedValue(baseIssue);
    issueFindFirst = vi.fn().mockImplementation(async () => ({
      ...baseIssue,
      assignees: [],
      labels: [],
    }));
    issueAggregate = vi.fn().mockResolvedValue({ _max: { sequenceId: 0 } });

    adjustDueDate = vi.fn().mockResolvedValue(MONDAY);

    type TxArg = {
      issue: {
        aggregate: typeof issueAggregate;
        create: typeof issueCreate;
        update: typeof issueUpdate;
        findFirst: typeof issueFindFirst;
      };
      issueAssignee: { createMany: ReturnType<typeof vi.fn> };
      issueLabel: { createMany: ReturnType<typeof vi.fn> };
      label: { findMany: ReturnType<typeof vi.fn> };
      issueState: { findUnique: ReturnType<typeof vi.fn> };
    };
    prisma = {
      $transaction: async (fn: (tx: TxArg) => unknown) =>
        fn({
          issue: {
            aggregate: issueAggregate,
            create: issueCreate,
            update: issueUpdate,
            findFirst: issueFindFirst,
          },
          issueAssignee: { createMany: vi.fn() },
          issueLabel: { createMany: vi.fn() },
          label: { findMany: vi.fn().mockResolvedValue([]) },
          issueState: { findUnique: vi.fn().mockResolvedValue(null) },
        }),
      issue: { findFirst: issueFindFirst },
      issueState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    activity = { record: vi.fn().mockResolvedValue('act_1') } as unknown as ActivityRecorderService;
    projects = {
      requireProject: vi.fn().mockResolvedValue(baseProject),
    } as unknown as ProjectsService;
    events = {
      publishIssueCreated: vi.fn(),
      publishIssueUpdated: vi.fn(),
      publishActivity: vi.fn(),
    } as unknown as TrackerEventsService;
    webhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebhookDispatcher;
    emitter = {
      emitIssueCreated: vi.fn(),
    } as unknown as TrackerEmitterService;
    holiday = { adjustDueDate } as unknown as HolidayService;

    service = new IssuesService(
      prisma,
      activity,
      projects,
      events,
      webhooks,
      emitter,
      undefined,
      undefined,
      undefined,
      holiday,
    );
  });

  it('create — dueDate в субботу сдвигается на понедельник через HolidayService', async () => {
    const dto: CreateIssueDto = {
      title: 'Test',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      dueDate: SATURDAY,
    } as unknown as CreateIssueDto;

    await service.create('p1', dto, 'org_1', 'u1');

    expect(adjustDueDate).toHaveBeenCalledTimes(1);
    expect(adjustDueDate).toHaveBeenCalledWith({
      tenantId: 'org_1',
      dueDate: SATURDAY,
    });
    const createArg = issueCreate.mock.calls[0]![0];
    expect(createArg.data.dueDate).toBe(MONDAY);
  });

  it('create — respectHolidays=false не вызывает HolidayService', async () => {
    const dto: CreateIssueDto = {
      title: 'Test',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      dueDate: SATURDAY,
      respectHolidays: false,
    } as unknown as CreateIssueDto;

    await service.create('p1', dto, 'org_1', 'u1');

    expect(adjustDueDate).not.toHaveBeenCalled();
    const createArg = issueCreate.mock.calls[0]![0];
    expect(createArg.data.dueDate).toBe(SATURDAY);
  });

  it('create — dueDate=null не вызывает HolidayService', async () => {
    const dto: CreateIssueDto = {
      title: 'Test',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
    } as unknown as CreateIssueDto;

    await service.create('p1', dto, 'org_1', 'u1');

    expect(adjustDueDate).not.toHaveBeenCalled();
    const createArg = issueCreate.mock.calls[0]![0];
    expect(createArg.data.dueDate).toBeNull();
  });

  it('create — HolidayService не инжектится → dueDate как есть', async () => {
    service = new IssuesService(
      prisma,
      activity,
      projects,
      events,
      webhooks,
      emitter,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const dto: CreateIssueDto = {
      title: 'Test',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      dueDate: SATURDAY,
    } as unknown as CreateIssueDto;

    await service.create('p1', dto, 'org_1', 'u1');
    const createArg = issueCreate.mock.calls[0]![0];
    expect(createArg.data.dueDate).toBe(SATURDAY);
  });

  it('update — dueDate в субботу сдвигается на понедельник', async () => {
    const dto: UpdateIssueDto = { dueDate: SATURDAY } as unknown as UpdateIssueDto;
    await service.update('i1', dto, 'org_1', 'u1');

    expect(adjustDueDate).toHaveBeenCalledTimes(1);
    expect(adjustDueDate).toHaveBeenCalledWith({
      tenantId: 'org_1',
      dueDate: SATURDAY,
    });
    expect(issueUpdate).toHaveBeenCalled();
    const updateArg = issueUpdate.mock.calls[0]![0];
    expect(updateArg.data.dueDate).toBe(MONDAY);
  });

  it('update — respectHolidays=false НЕ сдвигает dueDate', async () => {
    const dto: UpdateIssueDto = {
      dueDate: SATURDAY,
      respectHolidays: false,
    } as unknown as UpdateIssueDto;
    await service.update('i1', dto, 'org_1', 'u1');

    expect(adjustDueDate).not.toHaveBeenCalled();
    const updateArg = issueUpdate.mock.calls[0]![0];
    expect(updateArg.data.dueDate).toEqual(SATURDAY);
  });

  it('update — dueDate=null (снятие) НЕ вызывает HolidayService', async () => {
    const dto: UpdateIssueDto = { dueDate: null } as unknown as UpdateIssueDto;
    await service.update('i1', dto, 'org_1', 'u1');
    expect(adjustDueDate).not.toHaveBeenCalled();
  });

  it('update — HolidayService упал → warn-log, dueDate сохраняется как есть', async () => {
    adjustDueDate.mockRejectedValueOnce(new Error('db down'));
    const dto: UpdateIssueDto = { dueDate: SATURDAY } as unknown as UpdateIssueDto;
    await service.update('i1', dto, 'org_1', 'u1');
    const updateArg = issueUpdate.mock.calls[0]![0];
    expect(updateArg.data.dueDate).toEqual(SATURDAY);
  });

  // Фикс linkedMeetingIds 2026-06-17 — internal-поле проброса связки со встречей
  // в tx.issue.create (аналогично sourceBlockIds).
  it('create — непустой dto.linkedMeetingIds пробрасывается в tx.issue.create', async () => {
    const dto: CreateIssueDto = {
      title: 'Test',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      linkedMeetingIds: ['mtg_1'],
    } as unknown as CreateIssueDto;

    await service.create('p1', dto, 'org_1', 'u1');

    expect(issueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ linkedMeetingIds: ['mtg_1'] }),
      }),
    );
  });

  it('create — пустой/отсутствующий dto.linkedMeetingIds НЕ пробрасывает поле', async () => {
    const dto: CreateIssueDto = {
      title: 'Test',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
    } as unknown as CreateIssueDto;

    await service.create('p1', dto, 'org_1', 'u1');

    const createArg = issueCreate.mock.calls[0]![0];
    expect(createArg.data).not.toHaveProperty('linkedMeetingIds');
  });
});

describe('IssuesService — subtasks parent validation', () => {
  const baseProject = {
    id: 'p1',
    tenantId: 'org_1',
    identifier: 'KORA',
    defaultStateId: null,
  };
  const baseIssue: Issue = {
    id: 'i1',
    tenantId: 'org_1',
    projectId: 'p1',
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    deletedAt: null,
  } as unknown as Issue;

  function buildService(opts: {
    parentLookup: (id: string) => Partial<Issue> | null;
    childrenLookup: (parentIds: string[]) => Array<{ id: string }>;
    existing?: Issue;
  }) {
    const issueCreate = vi.fn().mockImplementation(async ({ data }) => ({
      ...(opts.existing ?? baseIssue),
      ...data,
    }));
    const issueUpdate = vi.fn().mockResolvedValue(opts.existing ?? baseIssue);
    const issueAggregate = vi.fn().mockResolvedValue({ _max: { sequenceId: 0 } });

    const issueFindFirst = vi
      .fn()
      .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === 'string' && opts.existing && where.id === opts.existing.id) {
          return {
            ...opts.existing,
            assignees: [],
            labels: [],
          };
        }
        if (typeof where.id === 'string') {
          const found = opts.parentLookup(where.id);
          if (!found) return null;
          return { id: found.id, projectId: found.projectId, parentId: found.parentId };
        }
        return null;
      });

    const issueFindMany = vi
      .fn()
      .mockImplementation(async ({ where }: { where: { parentId?: { in?: string[] } } }) => {
        const ins = where.parentId?.in ?? [];
        return opts.childrenLookup(ins);
      });

    type TxArg = {
      issue: {
        aggregate: typeof issueAggregate;
        create: typeof issueCreate;
        update: typeof issueUpdate;
        findFirst: typeof issueFindFirst;
        findMany: typeof issueFindMany;
      };
      issueAssignee: { createMany: ReturnType<typeof vi.fn> };
      issueLabel: { createMany: ReturnType<typeof vi.fn> };
      label: { findMany: ReturnType<typeof vi.fn> };
      issueState: { findUnique: ReturnType<typeof vi.fn> };
      $queryRaw: ReturnType<typeof vi.fn>;
    };

    const prisma = {
      $transaction: async (fn: (tx: TxArg) => unknown) =>
        fn({
          issue: {
            aggregate: issueAggregate,
            create: issueCreate,
            update: issueUpdate,
            findFirst: issueFindFirst,
            findMany: issueFindMany,
          },
          issueAssignee: { createMany: vi.fn() },
          issueLabel: { createMany: vi.fn() },
          label: { findMany: vi.fn().mockResolvedValue([]) },
          issueState: { findUnique: vi.fn().mockResolvedValue(null) },
          $queryRaw: vi.fn().mockResolvedValue([]),
        }),
      issue: { findFirst: issueFindFirst, findMany: issueFindMany },
      issueState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const activity = {
      record: vi.fn().mockResolvedValue('act_1'),
    } as unknown as ActivityRecorderService;
    const projects = {
      requireProject: vi.fn().mockResolvedValue(baseProject),
    } as unknown as ProjectsService;
    const events = {
      publishIssueCreated: vi.fn(),
      publishIssueUpdated: vi.fn(),
      publishActivity: vi.fn(),
    } as unknown as TrackerEventsService;
    const webhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebhookDispatcher;
    const emitter = {
      emitIssueCreated: vi.fn(),
    } as unknown as TrackerEmitterService;

    return new IssuesService(prisma, activity, projects, events, webhooks, emitter);
  }

  it('create — parentId без существующего родителя → BadRequest parent_not_found', async () => {
    const service = buildService({
      parentLookup: () => null,
      childrenLookup: () => [],
    });
    const dto: CreateIssueDto = {
      title: 'Child',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      parentId: 'unknown',
    } as unknown as CreateIssueDto;
    await expect(service.create('p1', dto, 'org_1', 'u1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'parent_not_found' }),
      }),
    });
  });

  it('create — parent в другом проекте → BadRequest parent_in_different_project', async () => {
    const service = buildService({
      parentLookup: () => ({
        id: 'p_other',
        projectId: 'p2',
        parentId: null,
      }),
      childrenLookup: () => [],
    });
    const dto: CreateIssueDto = {
      title: 'Child',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      parentId: 'p_other',
    } as unknown as CreateIssueDto;
    await expect(service.create('p1', dto, 'org_1', 'u1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({
          code: 'parent_in_different_project',
        }),
      }),
    });
  });

  it('create — parent сам подзадача (depth>2) → BadRequest max_subtask_depth_exceeded', async () => {
    const service = buildService({
      parentLookup: () => ({
        id: 'i_sub',
        projectId: 'p1',
        parentId: 'i_root',
      }),
      childrenLookup: () => [],
    });
    const dto: CreateIssueDto = {
      title: 'Grandchild',
      priority: 'medium',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      parentId: 'i_sub',
    } as unknown as CreateIssueDto;
    await expect(service.create('p1', dto, 'org_1', 'u1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({
          code: 'max_subtask_depth_exceeded',
        }),
      }),
    });
  });

  it('update — parentId = текущий id → BadRequest cyclic_parent_not_allowed', async () => {
    const service = buildService({
      parentLookup: () => null,
      childrenLookup: () => [],
      existing: baseIssue,
    });
    const dto: UpdateIssueDto = {
      parentId: 'i1',
    } as unknown as UpdateIssueDto;
    await expect(service.update('i1', dto, 'org_1', 'u1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({
          code: 'cyclic_parent_not_allowed',
        }),
      }),
    });
  });

  it('update — parent = потомок текущей задачи → BadRequest cyclic_parent_not_allowed', async () => {
    const service = buildService({
      parentLookup: () => ({
        id: 'i_child',
        projectId: 'p1',
        parentId: null,
      }),
      childrenLookup: (parentIds) => (parentIds.includes('i1') ? [{ id: 'i_child' }] : []),
      existing: baseIssue,
    });
    const dto: UpdateIssueDto = {
      parentId: 'i_child',
    } as unknown as UpdateIssueDto;
    await expect(service.update('i1', dto, 'org_1', 'u1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({
          code: 'cyclic_parent_not_allowed',
        }),
      }),
    });
  });

  it('update — parentId=null (сделать корневой) → не падает', async () => {
    const service = buildService({
      parentLookup: () => null,
      childrenLookup: () => [],
      existing: { ...baseIssue, parentId: 'some_parent' } as Issue,
    });
    const dto: UpdateIssueDto = {
      parentId: null,
    } as unknown as UpdateIssueDto;
    await expect(service.update('i1', dto, 'org_1', 'u1')).resolves.toBeDefined();
  });

  it('update — корректный новый parent (корневая задача того же проекта) → не падает', async () => {
    const service = buildService({
      parentLookup: (id) =>
        id === 'i_new_parent' ? { id: 'i_new_parent', projectId: 'p1', parentId: null } : null,
      childrenLookup: () => [],
      existing: baseIssue,
    });
    const dto: UpdateIssueDto = {
      parentId: 'i_new_parent',
    } as unknown as UpdateIssueDto;
    await expect(service.update('i1', dto, 'org_1', 'u1')).resolves.toBeDefined();
  });

  it('update — корректный новый parent (корневая задача того же проекта) → не падает', async () => {
    const service = buildService({
      parentLookup: (id) =>
        id === 'i_new_parent' ? { id: 'i_new_parent', projectId: 'p1', parentId: null } : null,
      childrenLookup: () => [],
      existing: baseIssue,
    });
    const dto: UpdateIssueDto = {
      parentId: 'i_new_parent',
    } as unknown as UpdateIssueDto;
    await expect(service.update('i1', dto, 'org_1', 'u1')).resolves.toBeDefined();
  });
});

describe('IssuesService — Б9 advisory_xact_lock', () => {
  const baseIssue = {
    id: 'i1',
    tenantId: 'org_1',
    projectId: 'p1',
    identifier: 'TASK-1',
    sequenceId: 1,
    title: 't',
    description: null,
    descriptionHtml: null,
    descriptionStripped: null,
    priority: 'normal',
    stateId: 'state_default',
    parentId: null,
    estimatePoints: null,
    sortOrder: 1,
    startDate: null,
    dueDate: null,
    cycleId: null,
    goalId: null,
    boardId: null,
    externalSource: null,
    externalId: null,
    createdById: 'u1',
    createdManually: true,
    deletedAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Issue;

  function buildServiceWithLockTracking(opts: {
    parentLookup: (id: string) => Partial<Issue> | null;
    childrenLookup?: (parentIds: string[]) => Array<{ id: string }>;
    existing?: Issue;
    serializeLock?: boolean;
  }): {
    service: IssuesService;
    queryRawCalls: Array<unknown[]>;
  } {
    const queryRawCalls: Array<unknown[]> = [];
    let lockHeld = false;
    const lockQueue: Array<() => void> = [];
    const queryRawMock = vi.fn().mockImplementation(async (...args: unknown[]) => {
      queryRawCalls.push(args);
      if (opts.serializeLock) {
        if (lockHeld) {
          await new Promise<void>((r) => lockQueue.push(r));
        }
        lockHeld = true;
      }
      return [];
    });

    const issueCreate = vi.fn().mockImplementation(async ({ data }) => ({
      ...(opts.existing ?? baseIssue),
      ...data,
    }));
    const issueUpdate = vi.fn().mockResolvedValue(opts.existing ?? baseIssue);
    const issueAggregate = vi.fn().mockResolvedValue({ _max: { sequenceId: 0 } });
    const issueFindFirst = vi
      .fn()
      .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === 'string' && opts.existing && where.id === opts.existing.id) {
          return { ...opts.existing, assignees: [], labels: [] };
        }
        if (typeof where.id === 'string') {
          const found = opts.parentLookup(where.id);
          if (!found) return null;
          return {
            id: found.id,
            projectId: found.projectId,
            parentId: found.parentId,
          };
        }
        return null;
      });
    const issueFindMany = vi
      .fn()
      .mockImplementation(async ({ where }: { where: { parentId?: { in?: string[] } } }) => {
        const ins = where.parentId?.in ?? [];
        return opts.childrenLookup ? opts.childrenLookup(ins) : [];
      });

    const releaseLock = (): void => {
      if (!opts.serializeLock) return;
      lockHeld = false;
      const next = lockQueue.shift();
      if (next) next();
    };

    const prisma = {
      $transaction: async (fn: (tx: Record<string, unknown>) => unknown) => {
        try {
          return await fn({
            issue: {
              aggregate: issueAggregate,
              create: issueCreate,
              update: issueUpdate,
              findFirst: issueFindFirst,
              findMany: issueFindMany,
            },
            issueAssignee: { createMany: vi.fn() },
            issueLabel: { createMany: vi.fn() },
            label: { findMany: vi.fn().mockResolvedValue([]) },
            issueState: { findUnique: vi.fn().mockResolvedValue(null) },
            $queryRaw: queryRawMock,
          });
        } finally {
          releaseLock();
        }
      },
      issue: { findFirst: issueFindFirst, findMany: issueFindMany },
      issueState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const activity = {
      record: vi.fn().mockResolvedValue('act_1'),
    } as unknown as ActivityRecorderService;
    const projects = {
      requireProject: vi.fn().mockResolvedValue({
        id: 'p1',
        identifier: 'TASK',
        defaultStateId: 'state_default',
      }),
    } as unknown as ProjectsService;
    const events = {
      publishIssueCreated: vi.fn(),
      publishIssueUpdated: vi.fn(),
      publishActivity: vi.fn(),
    } as unknown as TrackerEventsService;
    const webhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebhookDispatcher;
    const emitter = {
      emitIssueCreated: vi.fn(),
      emitIssueUpdated: vi.fn(),
      emitIssueCompleted: vi.fn(),
    } as unknown as TrackerEmitterService;

    const service = new IssuesService(prisma, activity, projects, events, webhooks, emitter);

    return { service, queryRawCalls };
  }

  it('$queryRaw(pg_advisory_xact_lock) вызывается ≥1 раз при update с parentId', async () => {
    const { service, queryRawCalls } = buildServiceWithLockTracking({
      parentLookup: (id) =>
        id === 'i_new_parent' ? { id: 'i_new_parent', projectId: 'p1', parentId: null } : null,
      existing: baseIssue,
    });

    await service.update(
      'i1',
      { parentId: 'i_new_parent' } as unknown as UpdateIssueDto,
      'org_1',
      'u1',
    );

    expect(queryRawCalls.length).toBeGreaterThan(0);
  });

  it("concurrent update: обе tx выполняются, обе дёргают $queryRaw на пересекающихся parent'ах", async () => {
    const { service, queryRawCalls } = buildServiceWithLockTracking({
      parentLookup: (id) =>
        id === 'p_shared' ? { id: 'p_shared', projectId: 'p1', parentId: null } : null,
      existing: baseIssue,
    });

    await Promise.all([
      service.update('i1', { parentId: 'p_shared' } as unknown as UpdateIssueDto, 'org_1', 'u1'),
      service.update('i1', { parentId: 'p_shared' } as unknown as UpdateIssueDto, 'org_1', 'u1'),
    ]);

    expect(queryRawCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('IssuesService — moveToProject', () => {
  type MoveOpts = {
    existing: Partial<Issue> | null;
    targetProject: {
      id: string;
      identifier: string;
      defaultStateId: string | null;
      archivedAt: Date | null;
    } | null;
    childrenCount?: number;
    currentStateCategory?: string | null;
    targetStateMatch?: { id: string } | null;
    targetMaxSequence?: number;
    targetBoardId?: string | null;
    withBoards?: boolean;
  };

  function buildService(opts: MoveOpts) {
    const issueUpdate = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'i1',
      ...data,
    }));
    const issueAggregate = vi
      .fn()
      .mockResolvedValue({ _max: { sequenceId: opts.targetMaxSequence ?? 0 } });
    const issueCount = vi.fn().mockResolvedValue(opts.childrenCount ?? 0);

    let assembleCall = 0;
    const issueFindFirst = vi.fn().mockImplementation(async () => {
      assembleCall++;
      if (assembleCall === 1) {
        return opts.existing ? { ...opts.existing, assignees: [], labels: [] } : null;
      }
      const last = issueUpdate.mock.calls.at(-1)?.[0]?.data ?? {};
      return {
        ...(opts.existing ?? {}),
        ...last,
        assignees: [],
        labels: [],
      };
    });

    const issueStateFindUnique = vi
      .fn()
      .mockResolvedValue(
        opts.currentStateCategory != null ? { category: opts.currentStateCategory } : null,
      );
    const issueStateFindFirst = vi.fn().mockResolvedValue(opts.targetStateMatch ?? null);

    const activityRecord = vi.fn().mockResolvedValue('act_move');

    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          issue: { aggregate: issueAggregate, update: issueUpdate },
        }),
      issue: { findFirst: issueFindFirst, count: issueCount },
      issueState: {
        findUnique: issueStateFindUnique,
        findFirst: issueStateFindFirst,
      },
    } as unknown as PrismaService;

    const activity = {
      record: activityRecord,
    } as unknown as ActivityRecorderService;
    const projects = {
      requireProject: vi.fn().mockImplementation(async () => {
        if (!opts.targetProject) {
          const { NotFoundException } = await import('@nestjs/common');
          throw new NotFoundException({
            ok: false,
            error: { code: 'project_not_found', message: 'Проект не найден' },
          });
        }
        return opts.targetProject;
      }),
    } as unknown as ProjectsService;
    const events = {
      publishIssueUpdated: vi.fn(),
      publishIssueMovedToProject: vi.fn(),
    } as unknown as TrackerEventsService;
    const webhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebhookDispatcher;
    const emitter = {} as unknown as TrackerEmitterService;
    const boards = opts.withBoards
      ? ({
          resolveDefaultBoardId: vi.fn().mockResolvedValue(opts.targetBoardId ?? null),
        } as unknown as import('./boards.service').BoardsService)
      : undefined;
    const metrics = {
      incIssueMovedToProject: vi.fn(),
    } as unknown as import('../../../common/metrics/business-metrics.service').BusinessMetricsService;

    const service = new IssuesService(
      prisma,
      activity,
      projects,
      events,
      webhooks,
      emitter,
      undefined,
      undefined,
      undefined,
      undefined,
      boards,
      metrics,
    );

    return {
      service,
      issueUpdate,
      issueAggregate,
      issueCount,
      issueStateFindFirst,
      activityRecord,
      events,
    };
  }

  const SRC_ISSUE: Partial<Issue> = {
    id: 'i1',
    tenantId: 'org_1',
    projectId: 'p_src',
    identifier: 'SRC-7',
    sequenceId: 7,
    title: 'Перенести меня',
    parentId: null,
    stateId: 'st_src_started',
    cycleId: 'cyc_1',
    boardId: 'b_src',
    linkedMeetingIds: [],
    sourceBlockIds: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    deletedAt: null,
  };

  const TARGET = {
    id: 'p_dst',
    identifier: 'DST',
    defaultStateId: 'st_dst_backlog',
    archivedAt: null,
  };

  it('успех — новый identifier/sequence, ремап state по category, board=default, cycle=null, activity verb=moved_to_project', async () => {
    const { service, issueUpdate, activityRecord, events } = buildService({
      existing: SRC_ISSUE,
      targetProject: TARGET,
      currentStateCategory: 'started',
      targetStateMatch: { id: 'st_dst_started' },
      targetMaxSequence: 14,
      withBoards: true,
      targetBoardId: 'b_dst',
    });

    const res = await service.moveToProject('i1', 'p_dst', 'org_1', 'u1');

    const updateArg = issueUpdate.mock.calls[0]![0];
    expect(updateArg.where).toEqual({ id: 'i1' });
    expect(updateArg.data.projectId).toBe('p_dst');
    expect(updateArg.data.sequenceId).toBe(15);
    expect(updateArg.data.identifier).toBe('DST-15');
    expect(updateArg.data.stateId).toBe('st_dst_started');
    expect(updateArg.data.boardId).toBe('b_dst');
    expect(updateArg.data.cycleId).toBeNull();

    expect(activityRecord).toHaveBeenCalledTimes(1);
    const actArg = activityRecord.mock.calls[0]![0];
    expect(actArg.verb).toBe('moved_to_project');
    expect(actArg.field).toBe('projectId');
    expect(actArg.oldValue).toBe('p_src');
    expect(actArg.newValue).toBe('p_dst');
    expect(actArg.metadata).toEqual({
      oldIdentifier: 'SRC-7',
      newIdentifier: 'DST-15',
    });

    expect(events.publishIssueUpdated).toHaveBeenCalledWith(expect.anything(), 'org_1', [
      'projectId',
      'identifier',
    ]);
    expect(events.publishIssueMovedToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'i1',
        fromProjectId: 'p_src',
        toProjectId: 'p_dst',
        oldIdentifier: 'SRC-7',
        newIdentifier: 'DST-15',
      }),
    );

    expect(res.identifier).toBe('DST-15');
  });

  it('ремап state — нет совпадающей category → defaultStateId целевого', async () => {
    const { service, issueUpdate } = buildService({
      existing: { ...SRC_ISSUE, stateId: 'st_src_started' },
      targetProject: TARGET,
      currentStateCategory: 'started',
      targetStateMatch: null,
      targetMaxSequence: 0,
      withBoards: false,
    });

    await service.moveToProject('i1', 'p_dst', 'org_1', 'u1');

    const updateArg = issueUpdate.mock.calls[0]![0];
    expect(updateArg.data.stateId).toBe('st_dst_backlog');
    expect(updateArg.data.identifier).toBe('DST-1');
  });

  it('same_project → 400', async () => {
    const { service } = buildService({
      existing: { ...SRC_ISSUE, projectId: 'p_dst' },
      targetProject: TARGET,
    });
    await expect(service.moveToProject('i1', 'p_dst', 'org_1', 'u1')).rejects.toMatchObject({
      response: { error: { code: 'same_project' } },
    });
  });

  it('чужой tenant (целевой проект не найден) → 404', async () => {
    const { service } = buildService({
      existing: SRC_ISSUE,
      targetProject: null,
    });
    await expect(service.moveToProject('i1', 'p_dst', 'org_1', 'u1')).rejects.toMatchObject({
      response: { error: { code: 'project_not_found' } },
    });
  });

  it('архивный целевой проект → 400 target_project_archived', async () => {
    const { service } = buildService({
      existing: SRC_ISSUE,
      targetProject: { ...TARGET, archivedAt: new Date() },
    });
    await expect(service.moveToProject('i1', 'p_dst', 'org_1', 'u1')).rejects.toMatchObject({
      response: { error: { code: 'target_project_archived' } },
    });
  });

  it('задача с parentId → 400 cannot_move_issue_with_subtasks', async () => {
    const { service } = buildService({
      existing: { ...SRC_ISSUE, parentId: 'i_parent' },
      targetProject: TARGET,
    });
    await expect(service.moveToProject('i1', 'p_dst', 'org_1', 'u1')).rejects.toMatchObject({
      response: { error: { code: 'cannot_move_issue_with_subtasks' } },
    });
  });

  it('задача с детьми → 400 cannot_move_issue_with_subtasks', async () => {
    const { service } = buildService({
      existing: SRC_ISSUE,
      targetProject: TARGET,
      childrenCount: 2,
    });
    await expect(service.moveToProject('i1', 'p_dst', 'org_1', 'u1')).rejects.toMatchObject({
      response: { error: { code: 'cannot_move_issue_with_subtasks' } },
    });
  });
});

/**
 * Фаза 2 ТЗ tasks-unified-workspace (К5) — DnD на доске «Все проекты».
 * `transitionToCategory` резолвит статус проекта по КАТЕГОРИИ (первый по
 * sequence, иначе defaultStateId) и делегирует в `transitionState`.
 */
describe('IssuesService — transitionToCategory', () => {
  type CatOpts = {
    /** Текущая задача (requireIssue). */
    existing: Partial<Issue>;
    /** Результат issueState.findFirst при резолве категории. null → нет. */
    categoryStateMatch?: { id: string } | null;
    /** Результат project.findUnique (fallback на defaultStateId). */
    projectDefaultStateId?: string | null;
    /**
     * Если задан — issueState.findFirst отдаёт это значение ВСЕМ вызовам
     * (нужно кейсу 5: transitionToCategory читает .id, реальный
     * transitionState читает .category из того же мока).
     */
    issueStateUnified?: { id: string; category: string } | null;
  };

  function buildService(opts: CatOpts) {
    const issueUpdate = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'i1',
      ...data,
    }));

    // requireIssue (без include) + assemble (с include) ходят в один
    // issue.findFirst. Отдаём existing с пустыми связями — assemble через
    // toResponseFromInclude обращается к assignees/labels.
    const issueFindFirst = vi.fn().mockImplementation(async () => {
      const last = issueUpdate.mock.calls.at(-1)?.[0]?.data ?? {};
      return {
        ...opts.existing,
        ...last,
        assignees: [],
        labels: [],
      };
    });

    // issueState.findFirst используется и в transitionToCategory (резолв
    // category), и внутри реального transitionState (валидация stateId).
    const issueStateFindFirst = vi
      .fn()
      .mockResolvedValue(
        opts.issueStateUnified ?? opts.categoryStateMatch ?? null,
      );

    const projectFindUnique = vi
      .fn()
      .mockResolvedValue(
        opts.projectDefaultStateId !== undefined
          ? { defaultStateId: opts.projectDefaultStateId }
          : null,
      );

    const activityRecord = vi.fn().mockResolvedValue('act_cat');

    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          issue: { update: issueUpdate },
        }),
      issue: { findFirst: issueFindFirst },
      issueState: { findFirst: issueStateFindFirst },
      project: { findUnique: projectFindUnique },
    } as unknown as PrismaService;

    const activity = {
      record: activityRecord,
    } as unknown as ActivityRecorderService;
    const projects = {} as unknown as ProjectsService;
    const events = {
      publishActivity: vi.fn(),
      publishIssueUpdated: vi.fn(),
    } as unknown as TrackerEventsService;
    const webhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebhookDispatcher;
    const emitter = {} as unknown as TrackerEmitterService;
    const metrics =
      {} as unknown as import('../../../common/metrics/business-metrics.service').BusinessMetricsService;

    const service = new IssuesService(
      prisma,
      activity,
      projects,
      events,
      webhooks,
      emitter,
      undefined, // embedQueue
      undefined, // inferFieldsSvc
      undefined, // goalSuggestSvc
      undefined, // holiday
      undefined, // boards
      metrics,
    );

    return {
      service,
      issueUpdate,
      issueStateFindFirst,
      projectFindUnique,
      activityRecord,
    };
  }

  const BASE: Partial<Issue> = {
    id: 'i1',
    tenantId: 'org_1',
    projectId: 'p1',
    identifier: 'P1-1',
    sequenceId: 1,
    title: 'Задача',
    parentId: null,
    stateId: 's_old',
    cycleId: null,
    boardId: null,
    completedAt: null,
    linkedMeetingIds: [],
    sourceBlockIds: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    deletedAt: null,
  };

  it('started — резолвит первый по sequence статус категории и делегирует в transitionState', async () => {
    const { service, issueStateFindFirst } = buildService({
      existing: { ...BASE, stateId: 's_old' },
      categoryStateMatch: { id: 's_started' },
    });
    const transitionStateSpy = vi
      .spyOn(service, 'transitionState')
      .mockResolvedValue({ id: 'i1' } as never);

    await service.transitionToCategory('i1', 'started', 'org_1', 'u1');

    expect(issueStateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', category: 'started' },
        orderBy: { sequence: 'asc' },
      }),
    );
    expect(transitionStateSpy).toHaveBeenCalledWith(
      'i1',
      { stateId: 's_started', reason: null },
      'org_1',
      'u1',
    );
  });

  it('идемпотентность — уже в нужном статусе → assemble, без transitionState', async () => {
    const { service } = buildService({
      existing: { ...BASE, stateId: 's_started' },
      categoryStateMatch: { id: 's_started' },
    });
    const transitionStateSpy = vi.spyOn(service, 'transitionState');
    const assembleSpy = vi
      .spyOn(service as unknown as { assemble: () => Promise<unknown> }, 'assemble')
      .mockResolvedValue({ id: 'i1' });

    await service.transitionToCategory('i1', 'started', 'org_1', 'u1');

    expect(assembleSpy).toHaveBeenCalled();
    expect(transitionStateSpy).not.toHaveBeenCalled();
  });

  it('нет статуса категории и нет defaultStateId → 400 no_state_for_category', async () => {
    const { service } = buildService({
      existing: { ...BASE, stateId: 's_old' },
      categoryStateMatch: null,
      projectDefaultStateId: null,
    });
    const transitionStateSpy = vi.spyOn(service, 'transitionState');

    await expect(
      service.transitionToCategory('i1', 'cancelled', 'org_1', 'u1'),
    ).rejects.toMatchObject({
      response: { error: { code: 'no_state_for_category' } },
    });
    expect(transitionStateSpy).not.toHaveBeenCalled();
  });

  it('нет статуса категории → fallback на defaultStateId проекта', async () => {
    const { service } = buildService({
      existing: { ...BASE, stateId: 's_old' },
      categoryStateMatch: null,
      projectDefaultStateId: 's_def',
    });
    const transitionStateSpy = vi
      .spyOn(service, 'transitionState')
      .mockResolvedValue({ id: 'i1' } as never);

    await service.transitionToCategory('i1', 'backlog', 'org_1', 'u1');

    expect(transitionStateSpy).toHaveBeenCalledWith(
      'i1',
      { stateId: 's_def', reason: null },
      'org_1',
      'u1',
    );
  });

  it('completed — полный путь через реальный transitionState проставляет completedAt', async () => {
    const { service, issueUpdate, activityRecord } = buildService({
      existing: { ...BASE, stateId: 's_old', completedAt: null, projectId: 'p1' },
      // Один мок для обоих вызовов issueState.findFirst:
      // transitionToCategory читает .id, transitionState читает .category.
      issueStateUnified: { id: 's_done', category: 'completed' },
    });

    await service.transitionToCategory('i1', 'completed', 'org_1', 'u1');

    // transitionState прошёл полностью: записал activity + update с completedAt.
    expect(activityRecord).toHaveBeenCalledTimes(1);
    const updateData = issueUpdate.mock.calls.at(0)?.[0]?.data;
    expect(updateData?.completedAt).toBeInstanceOf(Date);
  });
});
