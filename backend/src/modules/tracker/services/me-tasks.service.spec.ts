import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ProbeService } from '../../probe/probe.service';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';

import type { AssigneeResolverService } from './assignee-resolver.service';
import type { IssuesService } from './issues.service';
import { MeTasksService } from './me-tasks.service';
import type { ProgressUpdatesService } from './progress-updates.service';
import type { ProjectsService } from './projects.service';
import type { SkillRoutingService } from './skill-routing.service';
import type { TrackerEmitterService } from './tracker-emitter.service';

const TENANT = 'org_1';
const USER = 'user_1';
const INBOX = 'proj_inbox';

function makeCfg(overrides?: {
  assigneeClarifyEnabled?: boolean;
  dueDateClarifyEnabled?: boolean;
  assigneeProbePriorityHint?: number;
  completionDetailGateEnabled?: boolean;
}): TypedConfigService {
  return {
    tracker: {
      assigneeClarifyEnabled: overrides?.assigneeClarifyEnabled ?? true,
      dueDateClarifyEnabled: overrides?.dueDateClarifyEnabled ?? true,
      assigneeProbePriorityHint: overrides?.assigneeProbePriorityHint ?? 0.7,
      completionDetailGateEnabled: overrides?.completionDetailGateEnabled ?? true,
    },
    aiFeatures: { promptInjectionGuardEnabled: true },
  } as unknown as TypedConfigService;
}

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
  let probeSuggest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueStateFindUnique = vi.fn(async () => ({ category: 'backlog' }));
    issuesCreate = vi.fn(async () => makeIssueResponse({}));
    ensureInbox = vi.fn(async () => INBOX);
    probeSuggest = vi.fn(async () => ({ ok: true, probeEventId: 'probe_1' }));

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
      incTaskAssigneeClarify: vi.fn(),
    } as unknown as BusinessMetricsService;
    const progressUpdates = { create: vi.fn() } as unknown as ProgressUpdatesService;
    const probe = { suggest: probeSuggest } as unknown as ProbeService;
    const cfg = makeCfg();

    service = new MeTasksService(
      prisma,
      issues,
      projects,
      resolver,
      emitter,
      skillRouting,
      metrics,
      progressUpdates,
      probe,
      cfg,
    );
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

  it('(г) без срока → due-probe поднят на самого пользователя', async () => {
    await service.createSelfTask({ title: 'Позвонить клиенту' }, TENANT, USER);

    expect(probeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.due_date_missing',
        recipientCandidates: [USER],
        payload: expect.objectContaining({ contextCardId: 'issue_1' }),
      }),
    );
  });

  it('(д) есть срок → due-probe НЕ поднят', async () => {
    await service.createSelfTask(
      { title: 'Позвонить клиенту', dueDate: new Date('2026-06-30') },
      TENANT,
      USER,
    );
    expect(probeSuggest).not.toHaveBeenCalled();
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
  let incTaskAssigneeClarify: ReturnType<typeof vi.fn>;
  let probeSuggest: ReturnType<typeof vi.fn>;
  let suggestAssigneeMock: ReturnType<typeof vi.fn>;

  function build(cfgOverrides?: Parameters<typeof makeCfg>[0]): void {
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
    resolverResolve = vi.fn(async () => ({
      kind: 'resolved',
      userId: 'assignee_1',
      name: 'Айназ',
      via: 'name',
    }));
    emitAssigneeChanged = vi.fn();
    probeSuggest = vi.fn(async () => ({ ok: true, probeEventId: 'probe_1' }));
    suggestAssigneeMock = vi.fn(async () => []);

    prisma = {
      issueState: { findUnique: issueStateFindUnique },
      issue: { findUnique: issueFindUnique },
    } as unknown as PrismaService;
    issues = { create: issuesCreate } as unknown as IssuesService;
    projects = { ensureInboxProjectId: ensureInbox } as unknown as ProjectsService;
    resolver = { resolve: resolverResolve } as unknown as AssigneeResolverService;
    emitter = { emitIssueAssigneeChanged: emitAssigneeChanged } as unknown as TrackerEmitterService;
    incRoutingSuggestionAccepted = vi.fn();
    incTaskAssigneeClarify = vi.fn();
    const skillRouting = {
      suggestAssignee: suggestAssigneeMock,
    } as unknown as SkillRoutingService;
    const metrics = {
      incRoutingSuggestionAccepted,
      incTaskAssigneeClarify,
    } as unknown as BusinessMetricsService;
    const progressUpdates = { create: vi.fn() } as unknown as ProgressUpdatesService;
    const probe = { suggest: probeSuggest } as unknown as ProbeService;
    const cfg = makeCfg(cfgOverrides);

    service = new MeTasksService(
      prisma,
      issues,
      projects,
      resolver,
      emitter,
      skillRouting,
      metrics,
      progressUpdates,
      probe,
      cfg,
    );
  }

  beforeEach(() => build());

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

    expect(incTaskAssigneeClarify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'resolved_name' }),
    );
    expect(probeSuggest).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.assignee_unresolved' }),
    );

    expect(res.assignee).toEqual({ userId: 'assignee_1', name: 'Айназ' });
    expect(res.needsAssignee).toBeUndefined();
    expect(res.status).toBe('backlog');
  });

  it('(а2) resolved via memory → outcome resolved_memory', async () => {
    resolverResolve.mockResolvedValueOnce({
      kind: 'resolved',
      userId: 'assignee_1',
      name: 'Айназ',
      via: 'memory',
    });
    await service.assignTask(
      { title: 'X', assigneeName: 'он', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );
    expect(incTaskAssigneeClarify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'resolved_memory' }),
    );
  });

  it('(б) not_found → задача СОЗДАНА без исполнителя + probe assignee_unresolved, исключения нет', async () => {
    resolverResolve.mockResolvedValueOnce({ kind: 'not_found' });

    const res = await service.assignTask(
      { title: 'X', assigneeName: 'Нет', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const [, dtoArg] = issuesCreate.mock.calls[0] as [string, Record<string, unknown>, string, string];
    expect(dtoArg.assigneeUserIds).toEqual([]);
    expect(emitAssigneeChanged).not.toHaveBeenCalled();

    expect(probeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.assignee_unresolved',
        recipientCandidates: [USER],
        payload: expect.objectContaining({ contextCardId: 'issue_1', contextCardKind: 'issue' }),
      }),
    );
    expect(incTaskAssigneeClarify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'assignee_probe_raised' }),
    );

    expect(res.needsAssignee).toBe(true);
    expect(res.assignee).toBeUndefined();
    expect(res.message).toBe('Создал задачу во «Входящих». Уточню, на кого её повесить.');
  });

  it('(б2) not_found → подсказки skill-routing идут в candidates и в текст вопроса', async () => {
    resolverResolve.mockResolvedValueOnce({ kind: 'not_found' });
    suggestAssigneeMock.mockResolvedValueOnce([
      { personId: 'p1', userId: null, personName: 'Наташа', roleName: 'r', departmentName: 'd', confidence: 0.8, rationale: '', matchPath: 'semantic' },
      { personId: 'p2', userId: null, personName: 'Игорь', roleName: 'r', departmentName: 'd', confidence: 0.7, rationale: '', matchPath: 'semantic' },
    ]);

    const res = await service.assignTask(
      { title: 'заказать канцелярию', assigneeName: 'кто-нибудь', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(res.candidates).toEqual([
      { userId: null, name: 'Наташа' },
      { userId: null, name: 'Игорь' },
    ]);
    expect(probeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          suggestedQuestion: expect.stringContaining('Наташа, Игорь'),
        }),
      }),
    );
  });

  it('(в) ambiguous → задача создана + probe + candidates из резолвера', async () => {
    resolverResolve.mockResolvedValueOnce({
      kind: 'ambiguous',
      candidates: [
        { userId: 'u1', name: 'Айназ' },
        { userId: 'u2', name: 'Айназ' },
      ],
    });

    const res = await service.assignTask(
      { title: 'X', assigneeName: 'Айназ', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    expect(probeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.assignee_unresolved' }),
    );
    expect(res.needsAssignee).toBe(true);
    expect(res.candidates).toEqual([
      { userId: 'u1', name: 'Айназ' },
      { userId: 'u2', name: 'Айназ' },
    ]);
    expect(incTaskAssigneeClarify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'assignee_probe_raised' }),
    );
  });

  it('(г) collective → задача создана + probe + needsAssignee + сообщение про коллективный адресат', async () => {
    resolverResolve.mockResolvedValueOnce({ kind: 'collective', label: 'отдел продаж' });

    const res = await service.assignTask(
      { title: 'X', assigneeName: 'отдел продаж', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    expect(probeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.assignee_unresolved' }),
    );
    expect(res.needsAssignee).toBe(true);
    expect(res.message).toBe(
      'Создал задачу во «Входящих». Это коллективный адресат, уточню конкретного исполнителя.',
    );
    expect(incTaskAssigneeClarify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'collective_probe_raised' }),
    );
  });

  it('(д) без dueDate → probe due_date_missing поднят; с dueDate → НЕ поднят', async () => {
    await service.assignTask({ title: 'X', assigneeName: 'Айназ' }, TENANT, USER);
    expect(probeSuggest).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'task.due_date_missing',
        recipientCandidates: ['assignee_1'],
      }),
    );

    build();
    await service.assignTask(
      { title: 'X', assigneeName: 'Айназ', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );
    expect(probeSuggest).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.due_date_missing' }),
    );
  });

  it('(е) assigneeClarifyEnabled=false → assignee-probe НЕ поднят, но задача создана', async () => {
    build({ assigneeClarifyEnabled: false });
    resolverResolve.mockResolvedValueOnce({ kind: 'not_found' });

    const res = await service.assignTask(
      { title: 'X', assigneeName: 'Нет', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    expect(probeSuggest).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'task.assignee_unresolved' }),
    );
    expect(res.needsAssignee).toBe(true);
  });

  it('(ж) viaRouting=true (resolved) → учёт принятого предложения', async () => {
    await service.assignTask(
      { title: 'Протестировать бота', assigneeName: 'Айназ', viaRouting: true, dueDate: '2026-06-20' },
      TENANT,
      USER,
    );
    expect(incRoutingSuggestionAccepted).toHaveBeenCalledTimes(1);
  });

  it('(з) без viaRouting → метрика принятия НЕ вызвана', async () => {
    await service.assignTask(
      { title: 'Протестировать бота', assigneeName: 'Айназ', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );
    expect(incRoutingSuggestionAccepted).not.toHaveBeenCalled();
  });

  it('(и) best-effort: probe.suggest бросает → задача всё равно возвращается', async () => {
    resolverResolve.mockResolvedValueOnce({ kind: 'not_found' });
    probeSuggest.mockRejectedValue(new Error('boom'));

    const res = await service.assignTask(
      { title: 'X', assigneeName: 'Нет', dueDate: '2026-06-20' },
      TENANT,
      USER,
    );

    expect(res.id).toBe('issue_1');
    expect(res.needsAssignee).toBe(true);
  });

  it('(к) inbox недоступен → BadRequest, задача не создаётся', async () => {
    ensureInbox.mockResolvedValueOnce(null);
    await expect(
      service.assignTask({ title: 'X', assigneeName: 'Айназ' }, TENANT, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(issuesCreate).not.toHaveBeenCalled();
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
      incTaskAssigneeClarify: vi.fn(),
    } as unknown as BusinessMetricsService;
    const progressUpdates = { create: vi.fn() } as unknown as ProgressUpdatesService;
    const probe = { suggest: vi.fn() } as unknown as ProbeService;
    const cfg = makeCfg();

    service = new MeTasksService(
      prisma,
      issues,
      projects,
      resolver,
      emitter,
      skillRouting,
      metrics,
      progressUpdates,
      probe,
      cfg,
    );
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

function buildResolveHarness(opts?: {
  cfgOverrides?: Parameters<typeof makeCfg>[0];
  llmCall?: ReturnType<typeof vi.fn>;
  withLlm?: boolean;
}): {
  service: MeTasksService;
  issueFindMany: ReturnType<typeof vi.fn>;
  closureUpsert: ReturnType<typeof vi.fn>;
  progressCreate: ReturnType<typeof vi.fn>;
  probeSuggest: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
} {
  const issueFindMany = vi.fn(async () => [] as Array<{ id: string; title: string }>);
  const closureUpsert = vi.fn(async () => ({ id: 'cand_1', status: 'pending' }));
  const progressCreate = vi.fn(async () => ({ id: 'pu_1', issueId: 'issue_1' }));
  const probeSuggest = vi.fn(async () => ({ ok: true, probeEventId: 'probe_1' }));
  const llmCall =
    opts?.llmCall ??
    vi.fn(async () => ({
      text: JSON.stringify({
        done: true,
        confidence: 0.9,
        rationale: 'r',
        positiveSignals: [],
        negativeSignals: [],
      }),
    }));

  const prisma = {
    issue: { findMany: issueFindMany },
    taskClosureCandidate: { upsert: closureUpsert },
  } as unknown as PrismaService;
  const issues = {} as unknown as IssuesService;
  const projects = {} as unknown as ProjectsService;
  const resolver = {} as unknown as AssigneeResolverService;
  const emitter = {} as unknown as TrackerEmitterService;
  const skillRouting = {} as unknown as SkillRoutingService;
  const metrics = {} as unknown as BusinessMetricsService;
  const progressUpdates = { create: progressCreate } as unknown as ProgressUpdatesService;
  const probe = { suggest: probeSuggest } as unknown as ProbeService;
  const cfg = makeCfg(opts?.cfgOverrides);
  const llm =
    opts?.withLlm === false
      ? undefined
      : ({ call: llmCall } as unknown as LlmRouterService);

  const service = new MeTasksService(
    prisma,
    issues,
    projects,
    resolver,
    emitter,
    skillRouting,
    metrics,
    progressUpdates,
    probe,
    cfg,
    llm,
  );
  return { service, issueFindMany, closureUpsert, progressCreate, probeSuggest, llmCall };
}

describe('MeTasksService.resolveOpenTaskByName', () => {
  it('точное совпадение норм-строк → resolved', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Подготовить отчёт' }]);
    const res = await h.service.resolveOpenTaskByName(TENANT, USER, 'подготовить отчет');
    expect(res).toEqual({ kind: 'resolved', issueId: 'i1', title: 'Подготовить отчёт' });
  });

  it('частичное совпадение (includes) → resolved', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([
      { id: 'i1', title: 'Подготовить квартальный отчёт по продажам' },
    ]);
    const res = await h.service.resolveOpenTaskByName(TENANT, USER, 'квартальный отчёт');
    expect(res).toEqual({
      kind: 'resolved',
      issueId: 'i1',
      title: 'Подготовить квартальный отчёт по продажам',
    });
  });

  it('нет совпадений → not_found', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Совсем другая задача' }]);
    const res = await h.service.resolveOpenTaskByName(TENANT, USER, 'позвонить клиенту');
    expect(res).toEqual({ kind: 'not_found' });
  });

  it('две одинаковые задачи → ambiguous (срез кандидатов)', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([
      { id: 'i1', title: 'Отчёт' },
      { id: 'i2', title: 'Отчёт' },
    ]);
    const res = await h.service.resolveOpenTaskByName(TENANT, USER, 'отчёт');
    expect(res.kind).toBe('ambiguous');
    if (res.kind === 'ambiguous') {
      expect(res.candidates).toEqual([
        { issueId: 'i1', title: 'Отчёт' },
        { issueId: 'i2', title: 'Отчёт' },
      ]);
    }
  });

  it('запрос where исключает завершённые и отменённые + удалённые', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([]);
    await h.service.resolveOpenTaskByName(TENANT, USER, 'что-то');
    expect(h.issueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          deletedAt: null,
          assignees: { some: { userId: USER } },
          state: { category: { notIn: ['completed', 'cancelled'] } },
        }),
      }),
    );
  });

  it('нормализация ё→е: запрос «ещё отчёт» матчит title «еще отчет»', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'еще отчет' }]);
    const res = await h.service.resolveOpenTaskByName(TENANT, USER, 'ещё отчёт');
    expect(res).toEqual({ kind: 'resolved', issueId: 'i1', title: 'еще отчет' });
  });

  it('пустое имя → not_found без запроса в БД', async () => {
    const h = buildResolveHarness();
    const res = await h.service.resolveOpenTaskByName(TENANT, USER, '   ');
    expect(res).toEqual({ kind: 'not_found' });
    expect(h.issueFindMany).not.toHaveBeenCalled();
  });
});

describe('MeTasksService.completeTask', () => {
  it('(а) пустой note + gate ON → inline needs_detail, probe НЕ шлётся, кандидат НЕ создан', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Сделать макет' }]);
    const res = await h.service.completeTask({ taskName: 'сделать макет' }, TENANT, USER);

    expect(h.probeSuggest).not.toHaveBeenCalled();
    expect(h.closureUpsert).not.toHaveBeenCalled();
    expect(res).toEqual({
      candidateId: null,
      issueId: 'i1',
      title: 'Сделать макет',
      status: 'needs_detail',
      needsDetail: true,
      clarificationQuestion: 'Что конкретно вы сделали с задачей «Сделать макет»?',
    });
  });

  it('(б1) конкретный note + LLM verdict.done=true → кандидат создан, evidenceQuote=note', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Сделать макет' }]);
    const res = await h.service.completeTask(
      { taskName: 'сделать макет', note: 'собрал макет и отправил клиенту' },
      TENANT,
      USER,
    );

    expect(h.llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'task-closure-verify' }),
    );
    expect(h.probeSuggest).not.toHaveBeenCalled();
    expect(h.closureUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_issueId_sourceBlockId: {
            tenantId: TENANT,
            issueId: 'i1',
            sourceBlockId: `concierge-complete:${USER}`,
          },
        },
        create: expect.objectContaining({
          tenantId: TENANT,
          issueId: 'i1',
          sourceBlockId: `concierge-complete:${USER}`,
          status: 'pending',
          evidenceQuote: 'собрал макет и отправил клиенту',
          rationale: 'Отмечено выполненным через помощника',
          expiresAt: null,
        }),
        update: {},
      }),
    );
    expect(res).toEqual({
      candidateId: 'cand_1',
      issueId: 'i1',
      title: 'Сделать макет',
      status: 'pending',
    });
  });

  it('(б2) конкретный note + LLM verdict.done=false → недостаточно, inline needsDetail без probe', async () => {
    const h = buildResolveHarness({
      llmCall: vi.fn(async () => ({
        text: JSON.stringify({
          done: false,
          confidence: 0.8,
          rationale: 'r',
          positiveSignals: [],
          negativeSignals: [],
        }),
      })),
    });
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Сделать макет' }]);
    const res = await h.service.completeTask(
      { taskName: 'сделать макет', note: 'начал делать' },
      TENANT,
      USER,
    );
    expect(h.probeSuggest).not.toHaveBeenCalled();
    expect(h.closureUpsert).not.toHaveBeenCalled();
    expect(res.needsDetail).toBe(true);
    expect(res.candidateId).toBeNull();
  });

  it('(б3) непустой note + LLM отсутствует → fail-open, кандидат создан', async () => {
    const h = buildResolveHarness({ withLlm: false });
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Сделать макет' }]);
    const res = await h.service.completeTask(
      { taskName: 'сделать макет', note: 'готово' },
      TENANT,
      USER,
    );
    expect(h.probeSuggest).not.toHaveBeenCalled();
    expect(h.closureUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ evidenceQuote: 'готово' }) }),
    );
    expect(res.candidateId).toBe('cand_1');
  });

  it('(б4) непустой note + LLM бросает → fail-open, кандидат создан', async () => {
    const h = buildResolveHarness({
      llmCall: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Сделать макет' }]);
    const res = await h.service.completeTask(
      { taskName: 'сделать макет', note: 'готово' },
      TENANT,
      USER,
    );
    expect(h.closureUpsert).toHaveBeenCalledTimes(1);
    expect(res.candidateId).toBe('cand_1');
  });

  it('(в) gate OFF → кандидат создаётся всегда (старое поведение), note=null', async () => {
    const h = buildResolveHarness({ cfgOverrides: { completionDetailGateEnabled: false } });
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Сделать макет' }]);
    const res = await h.service.completeTask({ taskName: 'сделать макет' }, TENANT, USER);
    expect(h.probeSuggest).not.toHaveBeenCalled();
    expect(h.closureUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ evidenceQuote: null }) }),
    );
    expect(res).toEqual({
      candidateId: 'cand_1',
      issueId: 'i1',
      title: 'Сделать макет',
      status: 'pending',
    });
  });

  it('(в2) gate OFF + повторный вызов → upsert идемпотентен с пустым update', async () => {
    const h = buildResolveHarness({ cfgOverrides: { completionDetailGateEnabled: false } });
    h.issueFindMany.mockResolvedValue([{ id: 'i1', title: 'Сделать макет' }]);
    await h.service.completeTask({ taskName: 'сделать макет' }, TENANT, USER);
    await h.service.completeTask({ taskName: 'сделать макет' }, TENANT, USER);
    expect(h.closureUpsert).toHaveBeenCalledTimes(2);
    expect(h.closureUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });

  it('not_found → NotFoundException task_not_found, upsert не вызван', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([]);
    await expect(
      h.service.completeTask({ taskName: 'нет такой' }, TENANT, USER),
    ).rejects.toMatchObject({ response: { error: { code: 'task_not_found' } } });
    await expect(
      h.service.completeTask({ taskName: 'нет такой' }, TENANT, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.closureUpsert).not.toHaveBeenCalled();
  });

  it('ambiguous → ConflictException task_ambiguous с кандидатами', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValue([
      { id: 'i1', title: 'Отчёт' },
      { id: 'i2', title: 'Отчёт' },
    ]);
    await expect(
      h.service.completeTask({ taskName: 'отчёт' }, TENANT, USER),
    ).rejects.toMatchObject({
      response: { error: { code: 'task_ambiguous' } },
    });
    await expect(
      h.service.completeTask({ taskName: 'отчёт' }, TENANT, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.closureUpsert).not.toHaveBeenCalled();
  });
});

describe('MeTasksService.reportTaskProgress', () => {
  it('resolved → progressUpdates.create с health on_track и body=progress', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([{ id: 'i1', title: 'Внедрить CRM' }]);
    const res = await h.service.reportTaskProgress(
      { taskName: 'внедрить crm', progress: 'настроил воронку' },
      TENANT,
      USER,
    );
    expect(h.progressCreate).toHaveBeenCalledWith(
      'i1',
      { health: 'on_track', body: 'настроил воронку' },
      TENANT,
      USER,
    );
    expect(res).toEqual({ progressUpdateId: 'pu_1', issueId: 'i1', title: 'Внедрить CRM' });
  });

  it('not_found → NotFoundException, create не вызван', async () => {
    const h = buildResolveHarness();
    h.issueFindMany.mockResolvedValueOnce([]);
    await expect(
      h.service.reportTaskProgress({ taskName: 'нет', progress: 'x' }, TENANT, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.progressCreate).not.toHaveBeenCalled();
  });
});
