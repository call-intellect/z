import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { IntakeService } from './intake.service';

const TENANT = 'tenant-1';

type IntakeRow = {
  id: string;
  tenantId: string;
  projectId: string | null;
  status: string;
  source: string;
  sourceEmail: string | null;
  externalSource: string | null;
  externalId: string | null;
  rawContent: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedGoalId: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: Date | null;
  suggestedLabels: string[];
  sourceBlockIds: string[];
  confidence: null;
  triagedByUserId: string | null;
  triagedAt: Date | null;
  rejectedReason: string | null;
  snoozedUntil: Date | null;
  createdIssueId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeIntake(overrides: Partial<IntakeRow>): IntakeRow {
  const now = new Date('2026-06-11T00:00:00.000Z');
  return {
    id: 'intake-1',
    tenantId: TENANT,
    projectId: null,
    status: 'pending',
    source: 'in_app',
    sourceEmail: null,
    externalSource: null,
    externalId: null,
    rawContent: 'raw',
    extractedTitle: null,
    extractedDescription: null,
    suggestedProjectId: null,
    suggestedAssigneeId: null,
    suggestedGoalId: null,
    suggestedPriority: null,
    suggestedDueDate: null,
    suggestedLabels: [],
    sourceBlockIds: [],
    confidence: null,
    triagedByUserId: null,
    triagedAt: null,
    rejectedReason: null,
    snoozedUntil: null,
    createdIssueId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePrismaMock(opts: {
  intakes: IntakeRow[];
  projects: { id: string; name: string }[];
  goals: { id: string; name: string }[];
  persons: { userId: string | null; name: string }[];
}): { prisma: PrismaService; calls: { project: number; goal: number; person: number } } {
  const calls = { project: 0, goal: 0, person: 0 };
  const inArr = (where: { id?: { in: string[] }; userId?: { in: string[] } }) =>
    where.id?.in ?? where.userId?.in ?? [];
  const prisma = {
    intakeIssue: {
      findMany: vi.fn(async () => opts.intakes),
      count: vi.fn(async () => opts.intakes.length),
    },
    project: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] }; tenantId: string } }) => {
        calls.project += 1;
        const ids = new Set(inArr(args.where));
        return opts.projects.filter((p) => ids.has(p.id) && args.where.tenantId === TENANT);
      }),
    },
    goal: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] }; tenantId: string } }) => {
        calls.goal += 1;
        const ids = new Set(inArr(args.where));
        return opts.goals.filter((g) => ids.has(g.id) && args.where.tenantId === TENANT);
      }),
    },
    person: {
      findMany: vi.fn(async (args: { where: { userId: { in: string[] }; tenantId: string } }) => {
        calls.person += 1;
        const ids = new Set(inArr(args.where));
        return opts.persons.filter(
          (p) => p.userId != null && ids.has(p.userId) && args.where.tenantId === TENANT,
        );
      }),
    },
  } as unknown as PrismaService;
  return { prisma, calls };
}

function makeService(prisma: PrismaService): IntakeService {
  return new IntakeService(prisma, {} as never, {} as never, {} as never, {} as never);
}

const QUERY = { page: 1, limit: 50 } as never;

describe('IntakeService.findAll — резолв имён suggested*', () => {
  beforeEach(() => vi.clearAllMocks());

  it('(а) резолвит имена проекта, цели и исполнителя', async () => {
    const intake = makeIntake({
      id: 'i1',
      suggestedProjectId: 'proj-1',
      suggestedGoalId: 'goal-1',
      suggestedAssigneeId: 'user-1',
    });
    const { prisma } = makePrismaMock({
      intakes: [intake],
      projects: [{ id: 'proj-1', name: 'Маркетинг' }],
      goals: [{ id: 'goal-1', name: 'Удвоить выручку' }],
      persons: [{ userId: 'user-1', name: 'Иван Петров' }],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, QUERY);

    expect(res.items).toHaveLength(1);
    const item = res.items[0]!;
    expect(item.suggestedProjectName).toBe('Маркетинг');
    expect(item.suggestedGoalTitle).toBe('Удвоить выручку');
    expect(item.suggestedAssigneeName).toBe('Иван Петров');
    expect(item.suggestedProjectId).toBe('proj-1');
    expect(item.suggestedAssigneeId).toBe('user-1');
  });

  it('(б) null-ID → имя null без падения', async () => {
    const intake = makeIntake({ id: 'i2' });
    const { prisma, calls } = makePrismaMock({
      intakes: [intake],
      projects: [],
      goals: [],
      persons: [],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, QUERY);

    const item = res.items[0]!;
    expect(item.suggestedProjectName).toBeNull();
    expect(item.suggestedGoalTitle).toBeNull();
    expect(item.suggestedAssigneeName).toBeNull();
    expect(calls.project).toBe(0);
    expect(calls.goal).toBe(0);
    expect(calls.person).toBe(0);
  });

  it('(в) ID есть, но запись удалена/не найдена → имя null, cuid не протекает', async () => {
    const intake = makeIntake({
      id: 'i3',
      suggestedProjectId: 'proj-deleted',
      suggestedGoalId: 'goal-deleted',
      suggestedAssigneeId: 'user-deleted',
    });
    const { prisma, calls } = makePrismaMock({
      intakes: [intake],
      projects: [],
      goals: [],
      persons: [],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, QUERY);

    const item = res.items[0]!;
    expect(item.suggestedProjectName).toBeNull();
    expect(item.suggestedGoalTitle).toBeNull();
    expect(item.suggestedAssigneeName).toBeNull();
    expect(item.suggestedProjectId).toBe('proj-deleted');
    expect(calls.project).toBe(1);
    expect(calls.goal).toBe(1);
    expect(calls.person).toBe(1);
  });
});

describe('IntakeService.findAll — зеркало snooze очереди /actions (A4)', () => {
  beforeEach(() => vi.clearAllMocks());

  const USER = 'user-snooze';

  type SnoozeRow = {
    tenantId: string;
    userId: string;
    source: string;
    resourceId: string;
    snoozedUntil: Date;
  };

  function makeMirrorPrisma(opts: { intakes: IntakeRow[]; snoozes: SnoozeRow[] }): {
    prisma: PrismaService;
    snoozeQueries: number;
  } {
    const counter = { n: 0 };
    const applyWhere = (where: { status?: string; id?: { notIn: string[] } }): IntakeRow[] => {
      const notIn = new Set(where.id?.notIn ?? []);
      return opts.intakes.filter((i) => {
        if (where.status && i.status !== where.status) return false;
        if (notIn.has(i.id)) return false;
        return true;
      });
    };
    const prisma = {
      intakeIssue: {
        findMany: vi.fn(async (args: { where: { status?: string; id?: { notIn: string[] } } }) =>
          applyWhere(args.where),
        ),
        count: vi.fn(
          async (args: { where: { status?: string; id?: { notIn: string[] } } }) =>
            applyWhere(args.where).length,
        ),
      },
      pendingActionSnooze: {
        findMany: vi.fn(
          async (args: {
            where: {
              tenantId: string;
              userId: string;
              source: string;
              snoozedUntil: { gt: Date };
            };
          }) => {
            counter.n += 1;
            const now = args.where.snoozedUntil.gt;
            return opts.snoozes
              .filter(
                (s) =>
                  s.tenantId === args.where.tenantId &&
                  s.userId === args.where.userId &&
                  s.source === args.where.source &&
                  s.snoozedUntil > now,
              )
              .map((s) => ({ resourceId: s.resourceId }));
          },
        ),
      },
      project: { findMany: vi.fn(async () => []) },
      goal: { findMany: vi.fn(async () => []) },
      person: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaService;
    return { prisma, snoozeQueries: counter.n };
  }

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const PENDING_QUERY = { page: 1, limit: 50, status: 'pending' } as never;
  const DEFAULT_QUERY = { page: 1, limit: 50 } as never;
  const ACCEPTED_QUERY = { page: 1, limit: 50, status: 'accepted' } as never;

  it('pending-вид с userId исключает отложенную в очереди карточку (== вклад в /actions)', async () => {
    const a = makeIntake({ id: 'i-a', status: 'pending' });
    const b = makeIntake({ id: 'i-b', status: 'pending' });
    const { prisma } = makeMirrorPrisma({
      intakes: [a, b],
      snoozes: [
        {
          tenantId: TENANT,
          userId: USER,
          source: 'intake',
          resourceId: 'i-b',
          snoozedUntil: future,
        },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, PENDING_QUERY, USER);

    expect(res.total).toBe(1);
    expect(res.items.map((i) => i.id)).toEqual(['i-a']);
  });

  it('дефолтный вид (без status) тоже snooze-aware', async () => {
    const a = makeIntake({ id: 'i-a', status: 'pending' });
    const b = makeIntake({ id: 'i-b', status: 'pending' });
    const { prisma } = makeMirrorPrisma({
      intakes: [a, b],
      snoozes: [
        {
          tenantId: TENANT,
          userId: USER,
          source: 'intake',
          resourceId: 'i-a',
          snoozedUntil: future,
        },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, DEFAULT_QUERY, USER);

    expect(res.items.map((i) => i.id)).toEqual(['i-b']);
  });

  it('истёкший snooze не исключает карточку', async () => {
    const a = makeIntake({ id: 'i-a', status: 'pending' });
    const { prisma } = makeMirrorPrisma({
      intakes: [a],
      snoozes: [
        {
          tenantId: TENANT,
          userId: USER,
          source: 'intake',
          resourceId: 'i-a',
          snoozedUntil: past,
        },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, PENDING_QUERY, USER);

    expect(res.items.map((i) => i.id)).toEqual(['i-a']);
  });

  it('явный status=accepted НЕ применяет snooze (история разобранных полна)', async () => {
    const accepted = makeIntake({ id: 'i-acc', status: 'accepted' });
    const { prisma } = makeMirrorPrisma({
      intakes: [accepted],
      snoozes: [
        {
          tenantId: TENANT,
          userId: USER,
          source: 'intake',
          resourceId: 'i-acc',
          snoozedUntil: future,
        },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, ACCEPTED_QUERY, USER);

    expect(res.items.map((i) => i.id)).toEqual(['i-acc']);
    expect(prisma.pendingActionSnooze.findMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('без userId snooze не применяется (внутренние вызовы — поведение прежнее)', async () => {
    const a = makeIntake({ id: 'i-a', status: 'pending' });
    const b = makeIntake({ id: 'i-b', status: 'pending' });
    const { prisma } = makeMirrorPrisma({
      intakes: [a, b],
      snoozes: [
        {
          tenantId: TENANT,
          userId: USER,
          source: 'intake',
          resourceId: 'i-b',
          snoozedUntil: future,
        },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, PENDING_QUERY);

    expect(res.items.map((i) => i.id)).toEqual(['i-a', 'i-b']);
    expect(prisma.pendingActionSnooze.findMany as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});

describe('IntakeService.createFromMeetingNextStep', () => {
  beforeEach(() => vi.clearAllMocks());

  function build(opts: { meetingFound: boolean; existing?: IntakeRow | null }): {
    svc: IntakeService;
    create: ReturnType<typeof vi.fn>;
  } {
    const create = vi.fn(async ({ data }: { data: Partial<IntakeRow> }) =>
      makeIntake({ id: 'created-1', ...data }),
    );
    const prisma = {
      meeting: {
        findFirst: vi.fn(async () => (opts.meetingFound ? { id: 'm-1' } : null)),
      },
      intakeIssue: {
        findFirst: vi.fn(async () => opts.existing ?? null),
        create,
      },
    } as unknown as PrismaService;
    const events = { publishIntakeNewItem: vi.fn() };
    const webhooks = { dispatch: vi.fn(async () => undefined) };
    const cfg = { pendingActions: { intakeTtlDays: 14 } };
    const svc = new IntakeService(
      prisma,
      {} as never,
      events as never,
      webhooks as never,
      cfg as never,
    );
    return { svc, create };
  }

  it('happy-path: создаёт intake с правильными полями', async () => {
    const { svc, create } = build({ meetingFound: true });
    const res = await svc.createFromMeetingNextStep({
      meetingId: 'm-1',
      text: 'Согласовать бюджет с финансами',
      tenantId: TENANT,
    });
    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0]![0].data;
    expect(data.source).toBe('meeting');
    expect(data.rawContent).toBe('Согласовать бюджет с финансами');
    expect(data.extractedTitle).toBe('Согласовать бюджет с финансами');
    expect(data.externalSource).toBe('meeting');
    expect(String(data.externalId)).toMatch(/^meeting:m-1:[0-9a-f]{16}$/u);
    expect(res.source).toBe('meeting');
  });

  it('встреча не найдена → NotFoundException, create НЕ вызван', async () => {
    const { svc, create } = build({ meetingFound: false });
    await expect(
      svc.createFromMeetingNextStep({
        meetingId: 'm-x',
        text: 'что-то',
        tenantId: TENANT,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('идемпотентность: дубль по externalId → возвращаем существующий, create НЕ вызван', async () => {
    const existing = makeIntake({ id: 'dup-1', source: 'meeting' });
    const { svc, create } = build({ meetingFound: true, existing });
    const res = await svc.createFromMeetingNextStep({
      meetingId: 'm-1',
      text: 'повторный шаг',
      tenantId: TENANT,
    });
    expect(create).not.toHaveBeenCalled();
    expect(res.id).toBe('dup-1');
  });
});

describe('IntakeService.triage — DecisionTaskLink(derived) (A10)', () => {
  beforeEach(() => vi.clearAllMocks());

  const ACCEPT_DTO = {
    decision: 'accept',
    targetProjectId: 'proj-1',
  } as never;

  function build(opts: {
    intake: IntakeRow;
    matchingDecisions: { id: string }[];
    createdLinks: number;
  }): {
    svc: IntakeService;
    issuesCreate: ReturnType<typeof vi.fn>;
    decisionFindMany: ReturnType<typeof vi.fn>;
    decisionTaskLinkCreateMany: ReturnType<typeof vi.fn>;
    decisionUpdate: ReturnType<typeof vi.fn>;
  } {
    const issuesCreate = vi.fn(async () => ({ id: 'issue-created-1' }));
    const decisionFindMany = vi.fn(async () => opts.matchingDecisions);
    const decisionTaskLinkCreateMany = vi.fn(async () => ({
      count: opts.createdLinks,
    }));
    const decisionTaskLinkGroupBy = vi.fn(async () =>
      opts.matchingDecisions.map((d) => ({
        decisionId: d.id,
        _count: { _all: 1 },
      })),
    );
    const decisionUpdate = vi.fn(async () => ({}));
    const prisma = {
      intakeIssue: {
        findFirst: vi.fn(async () => opts.intake),
        update: vi.fn(async ({ data }: { data: Partial<IntakeRow> }) => ({
          ...opts.intake,
          ...data,
        })),
      },
      decision: {
        findMany: decisionFindMany,
        update: decisionUpdate,
      },
      decisionTaskLink: {
        createMany: decisionTaskLinkCreateMany,
        groupBy: decisionTaskLinkGroupBy,
      },
    } as unknown as PrismaService;
    const issues = { create: issuesCreate };
    const events = { publishIntakeTriaged: vi.fn() };
    const webhooks = { dispatch: vi.fn(async () => undefined) };
    const cfg = { pendingActions: { intakeTtlDays: 14 } };
    const svc = new IntakeService(
      prisma,
      issues as never,
      events as never,
      webhooks as never,
      cfg as never,
    );
    return {
      svc,
      issuesCreate,
      decisionFindMany,
      decisionTaskLinkCreateMany,
      decisionUpdate,
    };
  }

  it('(а) accept + пересекающийся Decision → DecisionTaskLink derived + пересчёт', async () => {
    const intake = makeIntake({
      id: 'i-acc',
      status: 'pending',
      projectId: 'proj-1',
      sourceBlockIds: ['blk-1', 'blk-2'],
    });
    const { svc, issuesCreate, decisionFindMany, decisionTaskLinkCreateMany, decisionUpdate } =
      build({
        intake,
        matchingDecisions: [{ id: 'dec-1' }],
        createdLinks: 1,
      });

    await svc.triage('i-acc', ACCEPT_DTO, TENANT, 'user-1');

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const issueDto = issuesCreate.mock.calls[0]![1] as {
      sourceBlockIds?: string[];
    };
    expect(issueDto.sourceBlockIds).toEqual(['blk-1', 'blk-2']);

    expect(decisionFindMany).toHaveBeenCalledTimes(1);
    expect(decisionTaskLinkCreateMany).toHaveBeenCalledTimes(1);
    const createArg = decisionTaskLinkCreateMany.mock.calls[0]![0] as {
      data: { decisionId: string; issueId: string; linkType: string }[];
      skipDuplicates: boolean;
    };
    expect(createArg.skipDuplicates).toBe(true);
    expect(createArg.data).toEqual([
      { decisionId: 'dec-1', issueId: 'issue-created-1', linkType: 'derived' },
    ]);
    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: 'dec-1' },
      data: { linkedTaskCount: 1 },
    });
  });

  it('(б) пустой sourceBlockIds → линк НЕ создаётся (no-op)', async () => {
    const intake = makeIntake({
      id: 'i-empty',
      status: 'pending',
      projectId: 'proj-1',
      sourceBlockIds: [],
    });
    const { svc, issuesCreate, decisionFindMany, decisionTaskLinkCreateMany } = build({
      intake,
      matchingDecisions: [],
      createdLinks: 0,
    });

    await svc.triage('i-empty', ACCEPT_DTO, TENANT, 'user-1');

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    expect(decisionFindMany).not.toHaveBeenCalled();
    expect(decisionTaskLinkCreateMany).not.toHaveBeenCalled();
  });

  it('(в) идемпотентность: повторный accept → createMany(skipDuplicates), не падает', async () => {
    const intake = makeIntake({
      id: 'i-idem',
      status: 'pending',
      projectId: 'proj-1',
      sourceBlockIds: ['blk-1'],
    });
    const { svc, decisionTaskLinkCreateMany, decisionUpdate } = build({
      intake,
      matchingDecisions: [{ id: 'dec-1' }],
      createdLinks: 0,
    });

    await expect(svc.triage('i-idem', ACCEPT_DTO, TENANT, 'user-1')).resolves.toBeDefined();

    const createArg = decisionTaskLinkCreateMany.mock.calls[0]![0] as {
      skipDuplicates: boolean;
    };
    expect(createArg.skipDuplicates).toBe(true);
    expect(decisionUpdate).not.toHaveBeenCalled();
  });
});

describe('IntakeService.triage — fallback «Входящие» (QA B1)', () => {
  beforeEach(() => vi.clearAllMocks());

  const ACCEPT_NO_PROJECT = { decision: 'accept' } as never;

  function build(opts: {
    intake: IntakeRow;
    existingDefault: { id: string } | null;
    withProjects?: boolean;
  }): {
    svc: IntakeService;
    issuesCreate: ReturnType<typeof vi.fn>;
    projectsCreate: ReturnType<typeof vi.fn>;
    projectFindFirst: ReturnType<typeof vi.fn>;
  } {
    const issuesCreate = vi.fn(async () => ({ id: 'issue-created-1' }));
    const projectsCreate = vi.fn(async () => ({ id: 'inbox-created' }));
    const projectFindFirst = vi.fn(async () => opts.existingDefault);
    const prisma = {
      intakeIssue: {
        findFirst: vi.fn(async () => opts.intake),
        update: vi.fn(async ({ data }: { data: Partial<IntakeRow> }) => ({
          ...opts.intake,
          ...data,
        })),
      },
      project: { findFirst: projectFindFirst },
      org: { findUnique: vi.fn(async () => ({ ownerId: 'org-owner' })) },
    } as unknown as PrismaService;
    const issues = { create: issuesCreate };
    const events = { publishIntakeTriaged: vi.fn() };
    const webhooks = { dispatch: vi.fn(async () => undefined) };
    const cfg = { pendingActions: { intakeTtlDays: 14 } };
    const projects = opts.withProjects === false ? undefined : { create: projectsCreate };
    const svc = new IntakeService(
      prisma,
      issues as never,
      events as never,
      webhooks as never,
      cfg as never,
      undefined,
      undefined,
      projects as never,
    );
    return { svc, issuesCreate, projectsCreate, projectFindFirst };
  }

  it('(а) accept без проекта, «Входящие» нет → создаёт (network=0, owner=Org) и кладёт задачу', async () => {
    const intake = makeIntake({
      id: 'i-noproj',
      status: 'pending',
      projectId: null,
      suggestedProjectId: null,
      sourceBlockIds: [],
    });
    const { svc, issuesCreate, projectsCreate } = build({
      intake,
      existingDefault: null,
    });

    await svc.triage('i-noproj', ACCEPT_NO_PROJECT, TENANT, 'user-1');

    expect(projectsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Входящие', network: 0 }),
      TENANT,
      'org-owner',
    );
    expect(issuesCreate).toHaveBeenCalledWith('inbox-created', expect.anything(), TENANT, 'user-1');
  });

  it('(б) accept без проекта, «Входящие» уже есть → переиспользует, create НЕ зван', async () => {
    const intake = makeIntake({
      id: 'i-noproj2',
      status: 'pending',
      projectId: null,
      suggestedProjectId: null,
      sourceBlockIds: [],
    });
    const { svc, issuesCreate, projectsCreate } = build({
      intake,
      existingDefault: { id: 'inbox-existing' },
    });

    await svc.triage('i-noproj2', ACCEPT_NO_PROJECT, TENANT, 'user-1');

    expect(projectsCreate).not.toHaveBeenCalled();
    expect(issuesCreate).toHaveBeenCalledWith(
      'inbox-existing',
      expect.anything(),
      TENANT,
      'user-1',
    );
  });

  it('(в) negative: ProjectsService недоступен → target_project_required', async () => {
    const intake = makeIntake({
      id: 'i-noproj3',
      status: 'pending',
      projectId: null,
      suggestedProjectId: null,
      sourceBlockIds: [],
    });
    const { svc, issuesCreate } = build({
      intake,
      existingDefault: null,
      withProjects: false,
    });

    await expect(svc.triage('i-noproj3', ACCEPT_NO_PROJECT, TENANT, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(issuesCreate).not.toHaveBeenCalled();
  });
});
