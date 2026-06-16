import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { IntakeService } from './intake.service';

/**
 * §1 Ф3 (2026-06-11) — unit-тесты резолва имён в `IntakeService.findAll`.
 *
 * Покрытие (детерминизм: мок Prisma, без сети/времени):
 *  (а) резолвит имена проекта / цели / исполнителя (Project.name / Goal.name /
 *      Person.name по userId);
 *  (б) null-ID → соответствующее имя null без падения;
 *  (в) ID есть, но запись удалена/не найдена → имя null (cuid НЕ протекает).
 */

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
      findMany: vi.fn(
        async (args: { where: { id: { in: string[] }; tenantId: string } }) => {
          calls.project += 1;
          const ids = new Set(inArr(args.where));
          return opts.projects.filter(
            (p) => ids.has(p.id) && args.where.tenantId === TENANT,
          );
        },
      ),
    },
    goal: {
      findMany: vi.fn(
        async (args: { where: { id: { in: string[] }; tenantId: string } }) => {
          calls.goal += 1;
          const ids = new Set(inArr(args.where));
          return opts.goals.filter(
            (g) => ids.has(g.id) && args.where.tenantId === TENANT,
          );
        },
      ),
    },
    person: {
      findMany: vi.fn(
        async (args: {
          where: { userId: { in: string[] }; tenantId: string };
        }) => {
          calls.person += 1;
          const ids = new Set(inArr(args.where));
          return opts.persons.filter(
            (p) => p.userId != null && ids.has(p.userId) && args.where.tenantId === TENANT,
          );
        },
      ),
    },
  } as unknown as PrismaService;
  return { prisma, calls };
}

function makeService(prisma: PrismaService): IntakeService {
  // issues / events / webhooks / cfg не задействованы в findAll — заглушки.
  return new IntakeService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
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
    // id остаются для рендеринга чипа, имена обогащены
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
    // нет id → не делаем лишних запросов
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
      projects: [], // ничего не найдено
      goals: [],
      persons: [],
    });
    const svc = makeService(prisma);

    const res = await svc.findAll(TENANT, QUERY);

    const item = res.items[0]!;
    // имена null — UI покажет fallback, не сырой cuid
    expect(item.suggestedProjectName).toBeNull();
    expect(item.suggestedGoalTitle).toBeNull();
    expect(item.suggestedAssigneeName).toBeNull();
    // id-поля содержат cuid (для рендера чипа), но имя null
    expect(item.suggestedProjectId).toBe('proj-deleted');
    // ровно по одному резолв-запросу на каждую сущность (есть id → запрос был)
    expect(calls.project).toBe(1);
    expect(calls.goal).toBe(1);
    expect(calls.person).toBe(1);
  });
});

/**
 * A4 (2026-06-14) — `/intake` как зеркало pending-секции `/actions`.
 *
 * Инвариант: дефолтный «требует разбора»-вид (status='pending' или статус не
 * задан) исключает карточки, отложенные пользователем через очередь
 * (PendingActionSnooze, source='intake', активный snoozedUntil) — тем же
 * фильтром, что IntakePendingProvider. Явный status=accepted историю не режет.
 *
 * Мок Prisma учитывает where.id.notIn в intakeIssue.findMany/count и
 * pendingActionSnooze.findMany по (tenantId, userId, source, snoozedUntil>now).
 */
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

  function makeMirrorPrisma(opts: {
    intakes: IntakeRow[];
    snoozes: SnoozeRow[];
  }): { prisma: PrismaService; snoozeQueries: number } {
    const counter = { n: 0 };
    const applyWhere = (where: {
      status?: string;
      id?: { notIn: string[] };
    }): IntakeRow[] => {
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
        count: vi.fn(async (args: { where: { status?: string; id?: { notIn: string[] } } }) =>
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
      // suggested*-резолв не задействован (нет suggested-полей в фикстурах).
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
    const b = makeIntake({ id: 'i-b', status: 'pending' }); // эту отложили
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
          snoozedUntil: past, // уже истёк
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

    // snooze-запрос не должен исключать разобранную карточку
    expect(res.items.map((i) => i.id)).toEqual(['i-acc']);
    expect(
      (prisma.pendingActionSnooze.findMany as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
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

    const res = await svc.findAll(TENANT, PENDING_QUERY); // без userId

    expect(res.items.map((i) => i.id)).toEqual(['i-a', 'i-b']);
    expect(
      (prisma.pendingActionSnooze.findMany as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
  });
});

/**
 * Редизайн кабинета Ф5а (2026-06-13) — next-step отчёта → кандидат в задачу.
 *
 * Покрытие:
 *   1. happy-path: встреча есть, дубля нет → intakeIssue.create вызван с
 *      source='meeting', rawContent=text, extractedTitle=text.slice(0,120),
 *      externalSource='meeting', externalId детерминирован.
 *   2. встреча не найдена / чужой tenant → NotFoundException, create НЕ вызван.
 *   3. идемпотентность: уже есть intake с тем же externalId → возвращаем его,
 *      create НЕ вызван.
 */
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
      {} as never, // issues
      events as never,
      webhooks as never,
      cfg as never,
      // autoTriageQueue @Optional — не передаём
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

  // Ф0 (ТЗ 2026-06-16) — гейт качества: текст-вопрос НЕ материализуется в
  // задачу (BadRequestException, create НЕ вызван).
  it('гейт качества: текст-вопрос → BadRequestException, create НЕ вызван', async () => {
    const { svc, create } = build({ meetingFound: true });
    await expect(
      svc.createFromMeetingNextStep({
        meetingId: 'm-1',
        text: 'Как нам ускорить релиз?',
        tenantId: TENANT,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * A10 (2026-06-14) — замыкание петли next-step → IntakeIssue.sourceBlockIds →
 * Issue → DecisionTaskLink('derived').
 *
 * Покрытие (детерминизм: мок Prisma, без сети/времени):
 *   (а) triage accept с непустым sourceBlockIds + пересекающийся Decision →
 *       создаётся DecisionTaskLink(linkType='derived') + пересчёт linkedTaskCount;
 *       в Issue прокидываются sourceBlockIds;
 *   (б) пустой sourceBlockIds → линк НЕ создаётся (no-op, decision.findMany не зван);
 *   (в) идемпотентность: повторный accept → createMany(skipDuplicates), не падает.
 */
describe('IntakeService.triage — DecisionTaskLink(derived) (A10)', () => {
  beforeEach(() => vi.clearAllMocks());

  const ACCEPT_DTO = {
    decision: 'accept',
    targetProjectId: 'proj-1',
  } as never;

  function build(opts: {
    intake: IntakeRow;
    /** Decision'ы, чьи sourceBlockIds пересекаются с задачей (мок findMany). */
    matchingDecisions: { id: string }[];
    /** createMany.count (число фактически созданных строк). */
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
    const {
      svc,
      issuesCreate,
      decisionFindMany,
      decisionTaskLinkCreateMany,
      decisionUpdate,
    } = build({
      intake,
      matchingDecisions: [{ id: 'dec-1' }],
      createdLinks: 1,
    });

    await svc.triage('i-acc', ACCEPT_DTO, TENANT, 'user-1');

    // Issue получил провенанс.
    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const issueDto = issuesCreate.mock.calls[0]![1] as {
      sourceBlockIds?: string[];
    };
    expect(issueDto.sourceBlockIds).toEqual(['blk-1', 'blk-2']);

    // Пересечение → createMany linkType='derived'.
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
    // Пересчёт linkedTaskCount.
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
    const { svc, issuesCreate, decisionFindMany, decisionTaskLinkCreateMany } =
      build({ intake, matchingDecisions: [], createdLinks: 0 });

    await svc.triage('i-empty', ACCEPT_DTO, TENANT, 'user-1');

    expect(issuesCreate).toHaveBeenCalledTimes(1);
    // Без блоков — даже не ходим в decision.findMany.
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
    // Повтор: пересечение есть, но createMany ничего не создал (count=0) —
    // skipDuplicates съел дубликат. Пересчёт счётчика пропускается (count=0).
    const { svc, decisionTaskLinkCreateMany, decisionUpdate } = build({
      intake,
      matchingDecisions: [{ id: 'dec-1' }],
      createdLinks: 0,
    });

    await expect(
      svc.triage('i-idem', ACCEPT_DTO, TENANT, 'user-1'),
    ).resolves.toBeDefined();

    const createArg = decisionTaskLinkCreateMany.mock.calls[0]![0] as {
      skipDuplicates: boolean;
    };
    expect(createArg.skipDuplicates).toBe(true);
    // count=0 → пересчёт linkedTaskCount не запускается.
    expect(decisionUpdate).not.toHaveBeenCalled();
  });
});

/**
 * QA B1 (2026-06-15) — fallback «Входящие» при accept без проекта.
 * Решение владельца: задача без привязки к проекту не должна выдавать ошибку
 * «не указан проект» — кладётся в общую папку «Входящие» tenant'а (тот же
 * проект, что использует авто-приём входящих: find-or-create по имени,
 * владелец = владелец Org).
 *
 * Покрытие (детерминизм: мок Prisma/ProjectsService):
 *   (а) accept без проекта, «Входящие» нет → создаётся (name=«Входящие»,
 *       network=0, owner=Org.ownerId) и Issue кладётся в него;
 *   (б) accept без проекта, «Входящие» уже есть → переиспользуется (create НЕ зван);
 *   (в) negative: ProjectsService недоступен (DI без него) → прежняя ошибка
 *       target_project_required (обратная совместимость).
 */
describe('IntakeService.triage — fallback «Входящие» (QA B1)', () => {
  beforeEach(() => vi.clearAllMocks());

  const ACCEPT_NO_PROJECT = { decision: 'accept' } as never;

  function build(opts: {
    intake: IntakeRow;
    /** Существующий дефолт-проект «Входящие» (project.findFirst), либо null. */
    existingDefault: { id: string } | null;
    /** Подключён ли ProjectsService (false = DI без него, как в проде нельзя). */
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
      undefined, // autoTriageQueue
      undefined, // blockFetch
      projects as never, // ProjectsService (@Optional)
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
      'org-owner', // владелец дефолт-проекта = владелец Org, не принявший
    );
    // Issue создан в свежесозданном дефолт-проекте «Входящие».
    expect(issuesCreate).toHaveBeenCalledWith(
      'inbox-created',
      expect.anything(),
      TENANT,
      'user-1',
    );
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

    await expect(
      svc.triage('i-noproj3', ACCEPT_NO_PROJECT, TENANT, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(issuesCreate).not.toHaveBeenCalled();
  });
});
