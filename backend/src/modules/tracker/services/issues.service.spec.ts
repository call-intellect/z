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

/**
 * Wave 3 finishing (Sprint 10, 2026-05-24) — unit-тесты на интеграцию
 * `HolidayService` в `IssuesService.create()` / `update()`.
 *
 * Изолированно проверяем только `dueDate`-сдвиг — остальные ветки сервиса
 * (RBAC, ingest в knowledge-core, embedding) покрыты другими файлами.
 */
describe('IssuesService — HolidayService integration', () => {
  const SATURDAY = new Date(Date.UTC(2026, 0, 3)); // 2026-01-03 (сб)
  const MONDAY = new Date(Date.UTC(2026, 0, 5)); // 2026-01-05 (пн)

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
    // null здесь, чтобы update() trackField('dueDate', adjustedDueDate) видел diff
    // и фактически вызывал tx.issue.update — так мы можем проверить переданное
    // значение dueDate.
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
      undefined, // embedQueue
      undefined, // inferFieldsSvc
      undefined, // goalSuggestSvc
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
    // dueDate в issue.create — это сдвинутая дата (понедельник).
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
      undefined, // holiday=undefined
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
    // requireIssue + assemble находят issue.
    const dto: UpdateIssueDto = { dueDate: SATURDAY } as unknown as UpdateIssueDto;
    await service.update('i1', dto, 'org_1', 'u1');

    expect(adjustDueDate).toHaveBeenCalledTimes(1);
    expect(adjustDueDate).toHaveBeenCalledWith({
      tenantId: 'org_1',
      dueDate: SATURDAY,
    });
    // Внутри транзакции issue.update получает скорректированный dueDate.
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
    // Под капотом — fallback на исходный dueDate.
    const updateArg = issueUpdate.mock.calls[0]![0];
    expect(updateArg.data.dueDate).toEqual(SATURDAY);
  });
});
