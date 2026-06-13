import { NotFoundException } from '@nestjs/common';
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
});
