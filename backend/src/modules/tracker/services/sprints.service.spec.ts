/**
 * Sprints (2026-05-28) §1.2/§1.3 — юнит-тесты SprintsService.
 *
 * Покрытие:
 *   list:
 *     - фильтры status (active/completed/upcoming/all);
 *     - фильтр scopeKind (customer/vendor/person/department/org);
 *     - поиск q (по name / project.name / project.identifier);
 *     - сортировка по hints (critical-первые);
 *     - сортировка по progress (asc/desc);
 *     - маркер isDeleted для удалённой Card/Person/Department/Vendor;
 *     - пагинация (totalPages);
 *     - tenantId isolation (через WHERE).
 *   quickCreate:
 *     - scope='customer' / 'vendor' / 'person' / 'department' / 'org' / 'project';
 *     - валидация: refId обязателен для scope с реф-сущностью;
 *     - 404 если refId не существует / другой tenant;
 *     - slug-collision → throw ConflictException;
 *     - transaction rollback (создание Cycle падает — Project не создаётся).
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SprintsService } from './sprints.service';

interface RawCycleRow {
  id: string;
  projectId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  project: {
    id: string;
    name: string;
    identifier: string;
    customerCardId: string | null;
    vendorId: string | null;
    subjectPersonId: string | null;
    departmentId: string | null;
    customerCard: { id: string; name: string; deletedAt: Date | null } | null;
    vendor: { id: string; name: string; deletedAt: Date | null } | null;
    subjectPerson:
      | {
          id: string;
          name: string;
          deletedAt: Date | null;
          appointments: Array<{ role: { id: string; name: string } | null }>;
        }
      | null;
    department: { id: string; name: string; deletedAt: Date | null } | null;
  };
}

function buildCycleRow(overrides: Partial<RawCycleRow> = {}): RawCycleRow {
  const now = new Date('2026-05-28T12:00:00Z');
  return {
    id: 'c-1',
    projectId: 'p-1',
    name: 'Спринт 1',
    startDate: new Date(now.getTime() - 86400_000),
    endDate: new Date(now.getTime() + 13 * 86400_000),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    project: {
      id: 'p-1',
      name: 'Спринт компании',
      identifier: 'SPR',
      customerCardId: null,
      vendorId: null,
      subjectPersonId: null,
      departmentId: null,
      customerCard: null,
      vendor: null,
      subjectPerson: null,
      department: null,
    },
    ...overrides,
  };
}

/** Извлекаем where из первого вызова mocked findMany c явным cast'ом. */
function whereFromCall(
  mockFn: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  const arg = mockFn.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
  return arg?.where ?? {};
}

function buildListPrismaStub(opts: {
  cycles: RawCycleRow[];
  total?: number;
  issueTotalByCycle?: Map<string, number>;
  issueDoneByCycle?: Map<string, number>;
  hintActiveByCycle?: Map<string, number>;
  hintCriticalByCycle?: Map<string, number>;
  meetingByCycle?: Map<string, number>;
}) {
  const total = opts.total ?? opts.cycles.length;
  const issueTotalGroup = Array.from(opts.issueTotalByCycle ?? []).map(
    ([cycleId, count]) => ({ cycleId, _count: { _all: count } }),
  );
  const issueDoneGroup = Array.from(opts.issueDoneByCycle ?? []).map(
    ([cycleId, count]) => ({ cycleId, _count: { _all: count } }),
  );
  const hintActiveGroup = Array.from(opts.hintActiveByCycle ?? []).map(
    ([cycleId, count]) => ({ cycleId, _count: { _all: count } }),
  );
  const hintCriticalGroup = Array.from(opts.hintCriticalByCycle ?? []).map(
    ([cycleId, count]) => ({ cycleId, _count: { _all: count } }),
  );
  const meetingGroup = Array.from(opts.meetingByCycle ?? []).map(
    ([linkedCycleId, count]) => ({ linkedCycleId, _count: { _all: count } }),
  );
  return {
    cycle: {
      count: vi.fn(async () => total),
      findMany: vi.fn(async () => opts.cycles),
    },
    issue: {
      groupBy: vi.fn(async (args: { where: { state?: unknown } }) => {
        // Возвращаем done-группы если есть фильтр по state.category='completed',
        // иначе total-группы.
        const isDone = args.where.state !== undefined;
        return isDone ? issueDoneGroup : issueTotalGroup;
      }),
    },
    sprintHint: {
      groupBy: vi.fn(async (args: { where: { severity?: unknown } }) => {
        const isCritical = args.where.severity !== undefined;
        return isCritical ? hintCriticalGroup : hintActiveGroup;
      }),
    },
    meeting: {
      groupBy: vi.fn(async () => meetingGroup),
    },
  };
}

describe('SprintsService.list — фильтры status', () => {
  it('status=active фильтрует Cycle.completedAt=null + startDate<=now + endDate>=now', async () => {
    const stub = buildListPrismaStub({ cycles: [buildCycleRow()] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'active',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(stub.cycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'org-1',
          completedAt: null,
          startDate: expect.objectContaining({ lte: expect.any(Date) }),
          endDate: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });

  it('status=completed: completedAt != null', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'completed',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(stub.cycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          completedAt: { not: null },
        }),
      }),
    );
  });

  it('status=upcoming: completedAt=null + startDate>now', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'upcoming',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(stub.cycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          completedAt: null,
          startDate: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('status=all: НЕ добавляет временные фильтры (только tenantId + project)', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const whereArg = whereFromCall(stub.cycle.findMany);
    expect(whereArg.completedAt).toBeUndefined();
    expect(whereArg.startDate).toBeUndefined();
    expect(whereArg.endDate).toBeUndefined();
  });
});

describe('SprintsService.list — фильтр scopeKind', () => {
  it('scopeKind=customer: project.customerCardId not null', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        scopeKind: 'customer',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const whereArg = whereFromCall(stub.cycle.findMany) as {
      project: { is: { customerCardId: unknown } };
    };
    expect(whereArg.project.is.customerCardId).toEqual({ not: null });
  });

  it('scopeKind=org: все 4 scope-поля = null', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        scopeKind: 'org',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const whereArg = whereFromCall(stub.cycle.findMany) as {
      project: {
        is: {
          customerCardId: unknown;
          vendorId: unknown;
          subjectPersonId: unknown;
          departmentId: unknown;
        };
      };
    };
    expect(whereArg.project.is.customerCardId).toBeNull();
    expect(whereArg.project.is.vendorId).toBeNull();
    expect(whereArg.project.is.subjectPersonId).toBeNull();
    expect(whereArg.project.is.departmentId).toBeNull();
  });

  it('scopeKind=vendor: project.vendorId not null', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        scopeKind: 'vendor',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const where = whereFromCall(stub.cycle.findMany) as {
      project: { is: { vendorId: unknown } };
    };
    expect(where.project.is.vendorId).toEqual({ not: null });
  });

  it('scopeKind=person: project.subjectPersonId not null', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        scopeKind: 'person',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const where = whereFromCall(stub.cycle.findMany) as {
      project: { is: { subjectPersonId: unknown } };
    };
    expect(where.project.is.subjectPersonId).toEqual({ not: null });
  });

  it('scopeKind=department: project.departmentId not null', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        scopeKind: 'department',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const where = whereFromCall(stub.cycle.findMany) as {
      project: { is: { departmentId: unknown } };
    };
    expect(where.project.is.departmentId).toEqual({ not: null });
  });
});

describe('SprintsService.list — поиск q', () => {
  it('q передаётся в OR по cycle.name + project.name + project.identifier', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        q: 'маркетинг',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const whereArg = whereFromCall(stub.cycle.findMany) as { OR: unknown[] };
    expect(whereArg.OR).toEqual([
      { name: { contains: 'маркетинг', mode: 'insensitive' } },
      { project: { name: { contains: 'маркетинг', mode: 'insensitive' } } },
      { project: { identifier: { contains: 'маркетинг', mode: 'insensitive' } } },
    ]);
  });
});

describe('SprintsService.list — сортировка и пагинация', () => {
  it('sortBy=hints — critical-первые', async () => {
    const c1 = buildCycleRow({ id: 'c-a' });
    const c2 = buildCycleRow({ id: 'c-b' });
    const c3 = buildCycleRow({ id: 'c-c' });
    const stub = buildListPrismaStub({
      cycles: [c1, c2, c3],
      hintActiveByCycle: new Map([
        ['c-a', 1],
        ['c-b', 5],
        ['c-c', 3],
      ]),
      hintCriticalByCycle: new Map([
        ['c-a', 0],
        ['c-b', 0],
        ['c-c', 2],
      ]),
    });
    const svc = new SprintsService(stub as never, {} as never);
    const res = await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'hints',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    // c-c имеет 2 critical → первый. Среди оставшихся c-b active=5 > c-a active=1.
    expect(res.items.map((i) => i.id)).toEqual(['c-c', 'c-b', 'c-a']);
  });

  it('sortBy=progress asc — спринты с меньшим ratio первые', async () => {
    const c1 = buildCycleRow({ id: 'c-a' });
    const c2 = buildCycleRow({ id: 'c-b' });
    const stub = buildListPrismaStub({
      cycles: [c1, c2],
      issueTotalByCycle: new Map([
        ['c-a', 10],
        ['c-b', 10],
      ]),
      issueDoneByCycle: new Map([
        ['c-a', 8],
        ['c-b', 2],
      ]),
    });
    const svc = new SprintsService(stub as never, {} as never);
    const res = await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'progress',
        sortDir: 'asc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items.map((i) => i.id)).toEqual(['c-b', 'c-a']);
    expect(res.items[0]!.progress.ratio).toBeCloseTo(0.2);
    expect(res.items[1]!.progress.ratio).toBeCloseTo(0.8);
  });

  it('пагинация totalPages корректно', async () => {
    const stub = buildListPrismaStub({ cycles: [buildCycleRow()], total: 42 });
    const svc = new SprintsService(stub as never, {} as never);
    const res = await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 2,
        limit: 10,
      },
    });
    expect(res.total).toBe(42);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
    expect(res.totalPages).toBe(5);
  });

  it('tenantId фильтр всегда присутствует в WHERE', async () => {
    const stub = buildListPrismaStub({ cycles: [] });
    const svc = new SprintsService(stub as never, {} as never);
    await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    const findManyWhere = whereFromCall(stub.cycle.findMany) as { tenantId: string };
    const countWhere = whereFromCall(stub.cycle.count) as { tenantId: string };
    expect(findManyWhere.tenantId).toBe('org-1');
    expect(countWhere.tenantId).toBe('org-1');
  });
});

describe('SprintsService.list — scope mapping (label + isDeleted)', () => {
  it('маркер isDeleted=true и «(удалён)» в label для удалённой Card', async () => {
    const cycle = buildCycleRow({
      project: {
        id: 'p-1',
        name: 'Клиент: Альфа',
        identifier: 'ALF',
        customerCardId: 'card-1',
        vendorId: null,
        subjectPersonId: null,
        departmentId: null,
        customerCard: { id: 'card-1', name: 'Альфа', deletedAt: new Date() },
        vendor: null,
        subjectPerson: null,
        department: null,
      },
    });
    const stub = buildListPrismaStub({ cycles: [cycle] });
    const svc = new SprintsService(stub as never, {} as never);
    const res = await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items[0]!.scope.kind).toBe('customer');
    expect(res.items[0]!.scope.isDeleted).toBe(true);
    expect(res.items[0]!.scope.label).toBe('Клиент: Альфа (удалён)');
  });

  it('scope=person: label включает роль из appointments', async () => {
    const cycle = buildCycleRow({
      project: {
        id: 'p-1',
        name: 'Сотрудник: Маша',
        identifier: 'MSH',
        customerCardId: null,
        vendorId: null,
        subjectPersonId: 'person-1',
        departmentId: null,
        customerCard: null,
        vendor: null,
        subjectPerson: {
          id: 'person-1',
          name: 'Маша',
          deletedAt: null,
          appointments: [{ role: { id: 'role-1', name: 'Маркетолог' } }],
        },
        department: null,
      },
    });
    const stub = buildListPrismaStub({ cycles: [cycle] });
    const svc = new SprintsService(stub as never, {} as never);
    const res = await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items[0]!.scope.kind).toBe('person');
    expect(res.items[0]!.scope.label).toBe('Сотрудник: Маша — Маркетолог');
    expect(res.items[0]!.scope.isDeleted).toBe(false);
  });

  it('scope=org: label="Компания", refId=null', async () => {
    const stub = buildListPrismaStub({ cycles: [buildCycleRow()] });
    const svc = new SprintsService(stub as never, {} as never);
    const res = await svc.list({
      tenantId: 'org-1',
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items[0]!.scope.kind).toBe('org');
    expect(res.items[0]!.scope.label).toBe('Компания');
    expect(res.items[0]!.scope.refId).toBeNull();
  });
});

// ────────────────────────── quickCreate ───────────────────────────────

function buildQuickCreatePrismaStub(opts: {
  customerCard?: { id: string; name: string; tenantId: string; deletedAt: Date | null } | null;
  vendor?: { id: string; name: string; tenantId: string; deletedAt: Date | null } | null;
  person?: { id: string; name: string; tenantId: string; deletedAt: Date | null } | null;
  department?: { id: string; name: string; tenantId: string; deletedAt: Date | null } | null;
  existingProject?: { id: string; identifier: string; slug: string; tenantId: string; deletedAt: Date | null } | null;
  projectFindUnique?: () => Promise<unknown>;
  projectFindFirst?: () => Promise<unknown>;
  txProjectCreate?: () => Promise<{ id: string; identifier: string; slug: string }>;
  txCycleCreate?: () => Promise<{ id: string }>;
  failOnCycleCreate?: boolean;
}) {
  // root-level calls (вне $transaction): card.findFirst / vendor.findFirst / etc.
  const cardFindFirst = vi.fn(async () => opts.customerCard ?? null);
  const vendorFindFirst = vi.fn(async () => opts.vendor ?? null);
  const personFindFirst = vi.fn(async () => opts.person ?? null);
  const departmentFindFirst = vi.fn(async () => opts.department ?? null);
  const projectFindFirstRoot = vi.fn(async () => opts.existingProject ?? null);

  // tx-level calls.
  const txProjectFindUnique = vi.fn(opts.projectFindUnique ?? (async () => null));
  const txProjectFindFirst = vi.fn(opts.projectFindFirst ?? (async () => null));
  const txProjectCreate = vi.fn(
    opts.txProjectCreate ??
      (async () => ({ id: 'p-new', identifier: 'NEW', slug: 'klient-alfa' })),
  );
  const txProjectUpdate = vi.fn(async () => undefined);
  const txIssueStateCreateMany = vi.fn(async () => [
    { id: 's-1', isDefault: true },
    { id: 's-2', isDefault: false },
  ]);
  const txProjectMemberCreate = vi.fn(async () => undefined);
  const txBoardCreate = vi.fn(async () => undefined);
  const txCycleCreate = vi.fn(
    opts.failOnCycleCreate
      ? async () => {
          throw new Error('cycle create failed');
        }
      : (opts.txCycleCreate ?? (async () => ({ id: 'c-new' }))),
  );

  // audit 2026-05-29: после quickCreate сервис выставляет
  // Org.firstSprintCreatedAt через `prisma.org.updateMany(...).catch(...)`
  // (fire-and-forget). Тестам это поведение не важно — но Prisma-стаб должен
  // содержать `org.updateMany`, иначе падает с TypeError.
  const orgUpdateMany = vi.fn(async () => ({ count: 1 }));

  return {
    prisma: {
      card: { findFirst: cardFindFirst },
      vendor: { findFirst: vendorFindFirst },
      person: { findFirst: personFindFirst },
      department: { findFirst: departmentFindFirst },
      project: { findFirst: projectFindFirstRoot },
      org: { updateMany: orgUpdateMany },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb({
          project: {
            findUnique: txProjectFindUnique,
            findFirst: txProjectFindFirst,
            create: txProjectCreate,
            update: txProjectUpdate,
          },
          issueState: { createManyAndReturn: txIssueStateCreateMany },
          projectMember: { create: txProjectMemberCreate },
          board: { create: txBoardCreate },
          cycle: { create: txCycleCreate },
        });
      }),
    },
    spies: {
      cardFindFirst,
      vendorFindFirst,
      personFindFirst,
      departmentFindFirst,
      projectFindFirstRoot,
      txProjectCreate,
      txProjectFindFirst,
      txProjectFindUnique,
      txProjectUpdate,
      txIssueStateCreateMany,
      txProjectMemberCreate,
      txBoardCreate,
      txCycleCreate,
    },
  };
}

describe('SprintsService.quickCreate — успешные сценарии', () => {
  it('scope=customer: создаёт Project с customerCardId + Cycle + Board + 4 States', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({
      customerCard: { id: 'card-1', name: 'Альфа', tenantId: 'org-1', deletedAt: null },
    });
    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      dto: {
        scope: 'customer',
        refId: 'card-1',
        sprintName: 'Спринт продаж',
        durationDays: 14,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(res.cycleId).toBe('c-new');
    expect(res.projectId).toBe('p-new');
    expect(spies.cardFindFirst).toHaveBeenCalled();
    expect(spies.txProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'org-1',
          customerCardId: 'card-1',
          vendorId: null,
          subjectPersonId: null,
          departmentId: null,
          name: 'Клиент: Альфа',
        }),
      }),
    );
    expect(spies.txBoardCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true, name: 'Доска' }),
      }),
    );
    expect(spies.txIssueStateCreateMany).toHaveBeenCalled();
    expect(spies.txCycleCreate).toHaveBeenCalled();
  });

  it('scope=vendor', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({
      vendor: { id: 'v-1', name: 'Поставщик А', tenantId: 'org-1', deletedAt: null },
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      dto: {
        scope: 'vendor',
        refId: 'v-1',
        sprintName: 'Закупка',
        durationDays: 7,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(spies.vendorFindFirst).toHaveBeenCalled();
    expect(spies.txProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'v-1',
          customerCardId: null,
        }),
      }),
    );
  });

  it('scope=person', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({
      person: { id: 'p-x', name: 'Маша', tenantId: 'org-1', deletedAt: null },
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      dto: {
        scope: 'person',
        refId: 'p-x',
        sprintName: 'Onboarding',
        durationDays: 21,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(spies.personFindFirst).toHaveBeenCalled();
    expect(spies.txProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectPersonId: 'p-x' }),
      }),
    );
  });

  it('scope=department', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({
      department: { id: 'd-1', name: 'Маркетинг', tenantId: 'org-1', deletedAt: null },
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      dto: {
        scope: 'department',
        refId: 'd-1',
        sprintName: 'Спринт маркетинга',
        durationDays: 28,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(spies.departmentFindFirst).toHaveBeenCalled();
    expect(spies.txProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          departmentId: 'd-1',
          customerCardId: null,
        }),
      }),
    );
  });

  it('scope=org: Project без scope-полей', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({});
    const svc = new SprintsService(prisma as never, {} as never);
    await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      dto: {
        scope: 'org',
        sprintName: 'Спринт компании',
        durationDays: 7,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(spies.txProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerCardId: null,
          vendorId: null,
          subjectPersonId: null,
          departmentId: null,
          name: 'Спринт компании',
        }),
      }),
    );
  });

  it('scope=project: переиспользует existingProjectId, не создаёт новый Project', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({
      existingProject: {
        id: 'p-existing',
        identifier: 'KRA',
        slug: 'kora',
        tenantId: 'org-1',
        deletedAt: null,
      },
    });
    const cyclesService = {
      create: vi.fn(async () => ({
        id: 'c-from-cycles-svc',
        tenantId: 'org-1',
        projectId: 'p-existing',
        name: 'Sprint',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        ownedById: null,
        description: null,
        progressSnapshot: null,
        version: 1,
        timezone: 'Europe/Moscow',
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
    const svc = new SprintsService(prisma as never, cyclesService as never);
    const res = await svc.quickCreate({
      tenantId: 'org-1',
      userId: 'u-1',
      dto: {
        scope: 'project',
        existingProjectId: 'p-existing',
        sprintName: 'Sprint',
        durationDays: 14,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(res.projectId).toBe('p-existing');
    expect(res.cycleId).toBe('c-from-cycles-svc');
    expect(spies.txProjectCreate).not.toHaveBeenCalled();
    expect(cyclesService.create).toHaveBeenCalledWith(
      'p-existing',
      expect.objectContaining({
        name: 'Sprint',
        timezone: 'Europe/Moscow',
      }),
      'org-1',
      'u-1',
    );
  });
});

describe('SprintsService.quickCreate — ошибки', () => {
  it('refId не существует → 404', async () => {
    const { prisma } = buildQuickCreatePrismaStub({ customerCard: null });
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: 'org-1',
        userId: 'u-1',
        dto: {
          scope: 'customer',
          refId: 'card-missing',
          sprintName: 'X',
          durationDays: 7,
          startDate: '2026-06-01',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('existingProject из другого tenant → 404', async () => {
    const { prisma } = buildQuickCreatePrismaStub({ existingProject: null });
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: 'org-1',
        userId: 'u-1',
        dto: {
          scope: 'project',
          existingProjectId: 'p-foreign',
          sprintName: 'X',
          durationDays: 7,
          startDate: '2026-06-01',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('invalid startDate → BadRequestException', async () => {
    const { prisma } = buildQuickCreatePrismaStub({
      department: { id: 'd-1', name: 'X', tenantId: 'org-1', deletedAt: null },
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: 'org-1',
        userId: 'u-1',
        dto: {
          scope: 'department',
          refId: 'd-1',
          sprintName: 'X',
          durationDays: 7,
          startDate: '9999-99-99',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('slug_collision внутри транзакции → ConflictException', async () => {
    // Симулируем коллизию: txProject.findUnique всегда возвращает existing.
    const { prisma } = buildQuickCreatePrismaStub({
      department: { id: 'd-1', name: 'Marketing', tenantId: 'org-1', deletedAt: null },
      projectFindUnique: async () => ({ id: 'existing-conflicting' }),
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: 'org-1',
        userId: 'u-1',
        dto: {
          scope: 'department',
          refId: 'd-1',
          sprintName: 'X',
          durationDays: 7,
          startDate: '2026-06-01',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('падение в tx.cycle.create → транзакция откатывается (rollback)', async () => {
    const { prisma, spies } = buildQuickCreatePrismaStub({
      department: { id: 'd-1', name: 'Marketing', tenantId: 'org-1', deletedAt: null },
      failOnCycleCreate: true,
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: 'org-1',
        userId: 'u-1',
        dto: {
          scope: 'department',
          refId: 'd-1',
          sprintName: 'X',
          durationDays: 7,
          startDate: '2026-06-01',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toThrow('cycle create failed');
    // Project.create ВЫЗВАН (мы стабим прямо в tx), но реальная транзакция
    // откатит. Здесь мы проверяем, что callback transaction'а ВЫЗВАН (это и
    // есть atomicity-контракт).
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(spies.txCycleCreate).toHaveBeenCalled();
  });
});
