import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';

import type { AssigneeResolverService } from './assignee-resolver.service';
import type { IssuesService } from './issues.service';
import { MeTasksService } from './me-tasks.service';
import type { ProjectsService } from './projects.service';
import type { SkillRoutingService } from './skill-routing.service';
import type { TrackerEmitterService } from './tracker-emitter.service';

const TENANT = 'org_1';
const USER = 'user_1';
const INBOX = 'proj_inbox';

function makeIssueResponse(overrides: Partial<IssueResponseDto>): IssueResponseDto {
  return {
    id: 'issue_1',
    tenantId: TENANT,
    projectId: INBOX,
    identifier: 'INB-1',
    sequenceId: 1,
    title: 'Задача',
    description: null,
    descriptionHtml: null,
    descriptionStripped: null,
    priority: 'none',
    stateId: 'state_backlog',
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
    previewQuote: null,
    previewSourceRef: null,
    confidence: null,
    createdManually: true,
    externalSource: 'assistant',
    externalId: null,
    entityId: null,
    createdById: USER,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    assigneeUserIds: [USER],
    labelIds: [],
    checklistTotalCount: 0,
    checklistDoneCount: 0,
    ...overrides,
  };
}

describe('MeTasksService.createSelfTask', () => {
  let prisma: PrismaService;
  let issues: IssuesService;
  let projects: ProjectsService;
  let service: MeTasksService;

  let issueStateFindUnique: ReturnType<typeof vi.fn>;
  let issuesCreate: ReturnType<typeof vi.fn>;
  let ensureInbox: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueStateFindUnique = vi.fn(async () => ({ category: 'backlog' }));
    issuesCreate = vi.fn(async () => makeIssueResponse({}));
    ensureInbox = vi.fn(async () => INBOX);

    prisma = {
      issueState: { findUnique: issueStateFindUnique },
      issue: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaService;
    issues = { create: issuesCreate } as unknown as IssuesService;
    projects = {
      ensureInboxProjectId: ensureInbox,
    } as unknown as ProjectsService;

    const resolver = { resolve: vi.fn() } as unknown as AssigneeResolverService;
    const emitter = {
      emitIssueAssigneeChanged: vi.fn(),
    } as unknown as TrackerEmitterService;
    const skillRouting = {
      suggestAssignee: vi.fn(async () => []),
    } as unknown as SkillRoutingService;
    const metrics = {
      incRoutingSuggestionAccepted: vi.fn(),
    } as unknown as BusinessMetricsService;

    service = new MeTasksService(prisma, issues, projects, resolver, emitter, skillRouting, metrics);
  });

  it('(а) создаёт задачу себе в «Входящих» с исполнителем = userId', async () => {
    const res = await service.createSelfTask(
      { title: 'Позвонить клиенту', description: 'до пятницы' },
      TENANT,
      USER,
    );

    expect(ensureInbox).toHaveBeenCalledWith(TENANT);

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const call = issuesCreate.mock.calls[0] as [string, Record<string, unknown>, string, string];
    const [projectIdArg, dtoArg, tenantArg, userArg] = call;
    expect(projectIdArg).toBe(INBOX);
    expect(tenantArg).toBe(TENANT);
    expect(userArg).toBe(USER);
    expect(dtoArg.title).toBe('Позвонить клиенту');
    expect(dtoArg.description).toBe('до пятницы');
    expect(dtoArg.assigneeUserIds).toEqual([USER]);
    expect(dtoArg.priority).toBe('none');
    expect(dtoArg.externalSource).toBe('assistant');

    expect(res).toEqual({
      id: 'issue_1',
      title: 'Задача',
      projectId: INBOX,
      status: 'backlog',
    });
  });

  it('(б) inbox-проект недоступен → BadRequest inbox_project_unavailable', async () => {
    ensureInbox.mockResolvedValueOnce(null);

    await expect(service.createSelfTask({ title: 'Что-то' }, TENANT, USER)).rejects.toMatchObject({
      response: { error: { code: 'inbox_project_unavailable' } },
    });
    expect(issuesCreate).not.toHaveBeenCalled();
  });

  it('(в) status = категория состояния созданной задачи', async () => {
    issuesCreate.mockResolvedValueOnce(makeIssueResponse({ stateId: 'state_started' }));
    issueStateFindUnique.mockResolvedValueOnce({ category: 'started' });

    const res = await service.createSelfTask({ title: 'X' }, TENANT, USER);

    expect(issueStateFindUnique).toHaveBeenCalledWith({
      where: { id: 'state_started' },
      select: { category: true },
    });
    expect(res.status).toBe('started');
  });

  it('(в2) stateId=null → status дефолт backlog без запроса в БД', async () => {
    issuesCreate.mockResolvedValueOnce(makeIssueResponse({ stateId: null }));

    const res = await service.createSelfTask({ title: 'X' }, TENANT, USER);

    expect(issueStateFindUnique).not.toHaveBeenCalled();
    expect(res.status).toBe('backlog');
  });

  it('защита BadRequestException — корректный тип ошибки', async () => {
    ensureInbox.mockResolvedValueOnce(null);
    await expect(service.createSelfTask({ title: 'X' }, TENANT, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('MeTasksService.assignTask', () => {
  let prisma: PrismaService;
  let issues: IssuesService;
  let projects: ProjectsService;
  let resolver: AssigneeResolverService;
  let emitter: TrackerEmitterService;
  let service: MeTasksService;

  let issuesCreate: ReturnType<typeof vi.fn>;
  let ensureInbox: ReturnType<typeof vi.fn>;
  let issueStateFindUnique: ReturnType<typeof vi.fn>;
  let issueFindUnique: ReturnType<typeof vi.fn>;
  let resolverResolve: ReturnType<typeof vi.fn>;
  let emitAssigneeChanged: ReturnType<typeof vi.fn>;
  let incRoutingSuggestionAccepted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issuesCreate = vi.fn(async () => makeIssueResponse({ assigneeUserIds: ['assignee_1'] }));
    ensureInbox = vi.fn(async () => INBOX);
    issueStateFindUnique = vi.fn(async () => ({ category: 'backlog' }));
    issueFindUnique = vi.fn(async () => ({
      id: 'issue_1',
      tenantId: TENANT,
      identifier: 'INB-1',
      title: 'Задача',
      description: null,
      projectId: INBOX,
      stateId: 'state_backlog',
      dueDate: null,
    }));
    resolverResolve = vi.fn(async () => ({ kind: 'resolved', userId: 'assignee_1', name: 'Айназ' }));
    emitAssigneeChanged = vi.fn();

    prisma = {
      issueState: { findUnique: issueStateFindUnique },
      issue: { findUnique: issueFindUnique },
    } as unknown as PrismaService;
    issues = { create: issuesCreate } as unknown as IssuesService;
    projects = { ensureInboxProjectId: ensureInbox } as unknown as ProjectsService;
    resolver = { resolve: resolverResolve } as unknown as AssigneeResolverService;
    emitter = { emitIssueAssigneeChanged: emitAssigneeChanged } as unknown as TrackerEmitterService;
    incRoutingSuggestionAccepted = vi.fn();
    const skillRouting = {
      suggestAssignee: vi.fn(async () => []),
    } as unknown as SkillRoutingService;
    const metrics = {
      incRoutingSuggestionAccepted,
    } as unknown as BusinessMetricsService;

    service = new MeTasksService(prisma, issues, projects, resolver, emitter, skillRouting, metrics);
  });

  it('(а) resolved → создаёт задачу на исполнителя + эмитит issue.assignee_changed(added)', async () => {
    const res = await service.assignTask(
      { title: 'Протестировать бота', assigneeName: 'Айназ', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(resolverResolve).toHaveBeenCalledWith(TENANT, 'Айназ');
    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const call = issuesCreate.mock.calls[0] as [string, Record<string, unknown>, string, string];
    const [, dtoArg] = call;
    expect(dtoArg.assigneeUserIds).toEqual(['assignee_1']);
    expect(dtoArg.externalSource).toBe('assistant');

    expect(emitAssigneeChanged).toHaveBeenCalledTimes(1);
    expect(emitAssigneeChanged).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'added', assigneeUserId: 'assignee_1' }),
    );

    expect(res.assignee).toEqual({ userId: 'assignee_1', name: 'Айназ' });
    expect(res.status).toBe('backlog');
  });

  it('(б) not_found → NotFoundException assignee_not_found, issues.create не вызван', async () => {
    resolverResolve.mockResolvedValueOnce({ kind: 'not_found' });
    await expect(
      service.assignTask({ title: 'X', assigneeName: 'Нет' }, TENANT, USER),
    ).rejects.toMatchObject({ response: { error: { code: 'assignee_not_found' } } });
    expect(issuesCreate).not.toHaveBeenCalled();
    expect(emitAssigneeChanged).not.toHaveBeenCalled();
  });

  it('(в) ambiguous → ConflictException assignee_ambiguous со списком имён', async () => {
    resolverResolve.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [
        { userId: 'u1', name: 'Айназ' },
        { userId: 'u2', name: 'Айназ' },
      ],
    });
    await expect(
      service.assignTask({ title: 'X', assigneeName: 'Айназ' }, TENANT, USER),
    ).rejects.toMatchObject({ response: { error: { code: 'assignee_ambiguous' } } });
    expect(issuesCreate).not.toHaveBeenCalled();
  });

  it('(г) viaRouting=true → учёт принятого предложения (incRoutingSuggestionAccepted)', async () => {
    await service.assignTask(
      { title: 'Протестировать бота', assigneeName: 'Айназ', viaRouting: true },
      TENANT,
      USER,
    );
    expect(incRoutingSuggestionAccepted).toHaveBeenCalledTimes(1);
  });

  it('(д) без viaRouting → метрика принятия НЕ вызвана', async () => {
    await service.assignTask(
      { title: 'Протестировать бота', assigneeName: 'Айназ' },
      TENANT,
      USER,
    );
    expect(incRoutingSuggestionAccepted).not.toHaveBeenCalled();
  });
});

describe('MeTasksService.suggestAssignee', () => {
  let service: MeTasksService;
  let suggestAssigneeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    suggestAssigneeMock = vi.fn(async () => [
      {
        personId: 'person_1',
        personName: 'Наташа',
        roleName: 'Офис-менеджер',
        departmentName: 'Администрация',
        confidence: 0.82,
        rationale: 'отвечает за снабжение',
        matchPath: 'semantic' as const,
      },
    ]);

    const prisma = {} as unknown as PrismaService;
    const issues = {} as unknown as IssuesService;
    const projects = {} as unknown as ProjectsService;
    const resolver = {} as unknown as AssigneeResolverService;
    const emitter = {} as unknown as TrackerEmitterService;
    const skillRouting = {
      suggestAssignee: suggestAssigneeMock,
    } as unknown as SkillRoutingService;
    const metrics = {
      incRoutingSuggestionAccepted: vi.fn(),
    } as unknown as BusinessMetricsService;

    service = new MeTasksService(prisma, issues, projects, resolver, emitter, skillRouting, metrics);
  });

  it('(а) делегирует в SkillRoutingService и возвращает {suggestions}', async () => {
    const res = await service.suggestAssignee({ taskText: 'заказать канцелярию' }, TENANT);

    expect(suggestAssigneeMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, taskText: 'заказать канцелярию' }),
    );
    expect(res).toEqual(
      expect.objectContaining({
        suggestions: expect.arrayContaining([
          expect.objectContaining({ personId: 'person_1', matchPath: 'semantic' }),
        ]),
      }),
    );
  });

  it('(б) departmentId → explicitTags; пустой результат → {suggestions: []}', async () => {
    suggestAssigneeMock.mockResolvedValueOnce([]);
    const res = await service.suggestAssignee(
      { taskText: 'сделать макет', departmentId: 'dep_1' },
      TENANT,
    );

    expect(suggestAssigneeMock).toHaveBeenCalledWith(
      expect.objectContaining({ explicitTags: { departmentId: 'dep_1' } }),
    );
    expect(res).toEqual({ suggestions: [] });
  });
});
