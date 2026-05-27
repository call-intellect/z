/**
 * Sprints (2026-05-28) §1.5 — integration-тесты на flow master-detail.
 *
 * Это «интеграция в DI-смысле»: SprintsService + CyclesService + PrismaService
 * (mocked) собираются вместе. Реальная Postgres-БД не нужна — для smoke
 * используется `scripts/smoke-sprints.ts` (расширяется в §1.7), а здесь мы
 * проверяем ПОЛНЫЙ контракт результата сервиса по сценариям ТЗ.
 *
 * Покрытие (соответствует §1.5):
 *   1. GET list с фильтром status=active — отдаёт active спринты;
 *   2. GET list с scopeKind=customer — фильтрует по project.customerCardId;
 *   3. GET list q='маркетинг' — попадает в OR-фильтр;
 *   4. GET list sortBy=hints — critical-первые;
 *   5. POST quick-create scope=customer — создаёт Project с customerCardId
 *      + Cycle + Board + 4 IssueStates атомарно;
 *   6. Повторный quick-create с тем же именем клиента — другой identifier
 *      (collision retry в generateProjectIdentifier);
 *   7. soft-deleted Card → list.scope.isDeleted=true, спринт всё ещё виден;
 *   8. tenant isolation — другой tenantId не виден.
 */
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SprintsService } from '../../src/modules/tracker/services/sprints.service';

const TENANT_A = 'org-A';
const TENANT_B = 'org-B';

// ── Полный fake-store: cards, vendors, persons, departments, projects, cycles, issues, hints, meetings, states, boards, members. ──

interface FakeRow extends Record<string, unknown> {
  id: string;
  tenantId: string;
  deletedAt?: Date | null;
}

interface ProjectRow extends FakeRow {
  slug: string;
  identifier: string;
  name: string;
  ownerId: string;
  network: number;
  timezone: string;
  cycleViewEnabled: boolean;
  intakeViewEnabled: boolean;
  customerCardId: string | null;
  vendorId: string | null;
  subjectPersonId: string | null;
  departmentId: string | null;
  defaultStateId: string | null;
}

interface CycleRow extends FakeRow {
  projectId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  timezone: string;
}

interface IssueRow extends FakeRow {
  cycleId: string | null;
  stateId: string | null;
}

interface HintRow extends FakeRow {
  cycleId: string;
  severity: string;
  status: string;
}

interface MeetingRow extends FakeRow {
  linkedCycleId: string | null;
}

// ── Фейковая БД ──

function buildFakeDb() {
  const cards: Array<FakeRow & { name: string }> = [];
  const vendors: Array<FakeRow & { name: string }> = [];
  const persons: Array<FakeRow & { name: string }> = [];
  const departments: Array<FakeRow & { name: string }> = [];
  const projects: ProjectRow[] = [];
  const cycles: CycleRow[] = [];
  const issues: IssueRow[] = [];
  const hints: HintRow[] = [];
  const meetings: MeetingRow[] = [];
  const issueStates: Array<{
    id: string;
    tenantId: string;
    projectId: string;
    category: string;
    isDefault: boolean;
  }> = [];
  const boards: Array<{
    id: string;
    tenantId: string;
    projectId: string;
    name: string;
    isDefault: boolean;
  }> = [];
  const projectMembers: Array<{ projectId: string; userId: string }> = [];

  let idCounter = 0;
  const nid = (prefix: string) => `${prefix}-${++idCounter}`;

  function matchProjectWhere(p: ProjectRow, where: Record<string, unknown>): boolean {
    if (where.tenantId !== undefined && p.tenantId !== where.tenantId) return false;
    if (where.deletedAt === null && p.deletedAt != null) return false;
    if (where.customerCardId === null && p.customerCardId !== null) return false;
    if (where.vendorId === null && p.vendorId !== null) return false;
    if (where.subjectPersonId === null && p.subjectPersonId !== null) return false;
    if (where.departmentId === null && p.departmentId !== null) return false;
    if (
      where.customerCardId &&
      typeof where.customerCardId === 'object' &&
      'not' in where.customerCardId &&
      (where.customerCardId as { not: null }).not === null &&
      p.customerCardId === null
    )
      return false;
    if (
      where.vendorId &&
      typeof where.vendorId === 'object' &&
      'not' in where.vendorId &&
      (where.vendorId as { not: null }).not === null &&
      p.vendorId === null
    )
      return false;
    if (
      where.subjectPersonId &&
      typeof where.subjectPersonId === 'object' &&
      'not' in where.subjectPersonId &&
      (where.subjectPersonId as { not: null }).not === null &&
      p.subjectPersonId === null
    )
      return false;
    if (
      where.departmentId &&
      typeof where.departmentId === 'object' &&
      'not' in where.departmentId &&
      (where.departmentId as { not: null }).not === null &&
      p.departmentId === null
    )
      return false;
    return true;
  }

  function matchCycleWhere(c: CycleRow, where: Record<string, unknown>): boolean {
    if (where.tenantId !== undefined && c.tenantId !== where.tenantId) return false;
    if (where.completedAt === null && c.completedAt !== null) return false;
    if (
      where.completedAt &&
      typeof where.completedAt === 'object' &&
      'not' in where.completedAt &&
      (where.completedAt as { not: null }).not === null &&
      c.completedAt === null
    )
      return false;
    if (where.startDate && typeof where.startDate === 'object') {
      const sd = where.startDate as { lte?: Date; gt?: Date };
      if (sd.lte && c.startDate.getTime() > sd.lte.getTime()) return false;
      if (sd.gt && c.startDate.getTime() <= sd.gt.getTime()) return false;
    }
    if (where.endDate && typeof where.endDate === 'object') {
      const ed = where.endDate as { gte?: Date };
      if (ed.gte && c.endDate.getTime() < ed.gte.getTime()) return false;
    }
    if (where.project && typeof where.project === 'object') {
      const projectFilter = where.project as { is?: Record<string, unknown> };
      if (projectFilter.is) {
        const project = projects.find((p) => p.id === c.projectId);
        if (!project) return false;
        if (!matchProjectWhere(project, projectFilter.is)) return false;
      }
    }
    if (where.OR && Array.isArray(where.OR)) {
      const project = projects.find((p) => p.id === c.projectId);
      const matched = where.OR.some((orCond) => {
        if (!orCond || typeof orCond !== 'object') return false;
        const oc = orCond as {
          name?: { contains: string };
          project?: {
            name?: { contains: string };
            identifier?: { contains: string };
          };
        };
        if (oc.name?.contains && c.name.toLowerCase().includes(oc.name.contains.toLowerCase()))
          return true;
        if (
          oc.project?.name?.contains &&
          project?.name.toLowerCase().includes(oc.project.name.contains.toLowerCase())
        )
          return true;
        if (
          oc.project?.identifier?.contains &&
          project?.identifier.toLowerCase().includes(oc.project.identifier.contains.toLowerCase())
        )
          return true;
        return false;
      });
      if (!matched) return false;
    }
    return true;
  }

  const prisma = {
    card: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        return (
          cards.find(
            (c) =>
              c.id === args.where.id &&
              c.tenantId === args.where.tenantId &&
              (!args.where.deletedAt || c.deletedAt === null),
          ) ?? null
        );
      }),
    },
    vendor: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        return (
          vendors.find(
            (v) =>
              v.id === args.where.id &&
              v.tenantId === args.where.tenantId &&
              (!args.where.deletedAt || v.deletedAt === null),
          ) ?? null
        );
      }),
    },
    person: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        return (
          persons.find(
            (p) =>
              p.id === args.where.id &&
              p.tenantId === args.where.tenantId &&
              (!args.where.deletedAt || p.deletedAt === null),
          ) ?? null
        );
      }),
    },
    department: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        return (
          departments.find(
            (d) =>
              d.id === args.where.id &&
              d.tenantId === args.where.tenantId &&
              (!args.where.deletedAt || d.deletedAt === null),
          ) ?? null
        );
      }),
    },
    project: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const found = projects.find(
          (p) =>
            p.id === args.where.id &&
            p.tenantId === args.where.tenantId &&
            (args.where.deletedAt !== null || p.deletedAt === null),
        );
        return found ?? null;
      }),
      // findUnique - используется в utils/translit для проверки коллизий slug
      findUnique: vi.fn(async (args: {
        where: { tenantId_slug?: { tenantId: string; slug: string } };
      }) => {
        if (args.where.tenantId_slug) {
          return (
            projects.find(
              (p) =>
                p.tenantId === args.where.tenantId_slug!.tenantId &&
                p.slug === args.where.tenantId_slug!.slug,
            ) ?? null
          );
        }
        return null;
      }),
    },
    cycle: {
      count: vi.fn(async (args: { where: Record<string, unknown> }) => {
        return cycles.filter((c) => matchCycleWhere(c, args.where)).length;
      }),
      findMany: vi.fn(
        async (args: {
          where: Record<string, unknown>;
          orderBy?: Array<{ startDate?: 'asc' | 'desc' }>;
          skip?: number;
          take?: number;
        }) => {
          const filtered = cycles.filter((c) => matchCycleWhere(c, args.where));
          // sort by startDate
          const dir = args.orderBy?.[0]?.startDate ?? 'desc';
          filtered.sort((a, b) => {
            const cmp = a.startDate.getTime() - b.startDate.getTime();
            return dir === 'asc' ? cmp : -cmp;
          });
          const skip = args.skip ?? 0;
          const take = args.take ?? 100;
          const page = filtered.slice(skip, skip + take);
          return page.map((c) => {
            const project = projects.find((p) => p.id === c.projectId)!;
            return {
              ...c,
              project: {
                ...project,
                customerCard:
                  project.customerCardId !== null
                    ? cards.find((cd) => cd.id === project.customerCardId) ?? null
                    : null,
                vendor:
                  project.vendorId !== null
                    ? vendors.find((v) => v.id === project.vendorId) ?? null
                    : null,
                subjectPerson:
                  project.subjectPersonId !== null
                    ? {
                        ...(persons.find((p) => p.id === project.subjectPersonId) ?? {}),
                        appointments: [],
                      }
                    : null,
                department:
                  project.departmentId !== null
                    ? departments.find((d) => d.id === project.departmentId) ?? null
                    : null,
              },
            };
          });
        },
      ),
    },
    issue: {
      groupBy: vi.fn(
        async (args: {
          by: string[];
          where: {
            tenantId: string;
            cycleId: { in: string[] };
            deletedAt: null;
            state?: { category: string };
          };
        }) => {
          const isDone = args.where.state?.category === 'completed';
          const matched = issues.filter(
            (i) =>
              i.tenantId === args.where.tenantId &&
              i.cycleId !== null &&
              args.where.cycleId.in.includes(i.cycleId) &&
              i.deletedAt === null &&
              (!isDone || (i.stateId && issueStates.find((s) => s.id === i.stateId)?.category === 'completed')),
          );
          const grouped = new Map<string, number>();
          for (const i of matched) {
            const cid = i.cycleId!;
            grouped.set(cid, (grouped.get(cid) ?? 0) + 1);
          }
          return Array.from(grouped).map(([cycleId, count]) => ({
            cycleId,
            _count: { _all: count },
          }));
        },
      ),
    },
    sprintHint: {
      groupBy: vi.fn(
        async (args: {
          by: string[];
          where: {
            tenantId: string;
            cycleId: { in: string[] };
            status: string;
            severity?: string;
          };
        }) => {
          const matched = hints.filter(
            (h) =>
              h.tenantId === args.where.tenantId &&
              args.where.cycleId.in.includes(h.cycleId) &&
              h.status === args.where.status &&
              (args.where.severity === undefined ||
                h.severity === args.where.severity),
          );
          const grouped = new Map<string, number>();
          for (const h of matched) {
            grouped.set(h.cycleId, (grouped.get(h.cycleId) ?? 0) + 1);
          }
          return Array.from(grouped).map(([cycleId, count]) => ({
            cycleId,
            _count: { _all: count },
          }));
        },
      ),
    },
    meeting: {
      groupBy: vi.fn(
        async (args: {
          by: string[];
          where: { tenantId: string; linkedCycleId: { in: string[] } };
        }) => {
          const matched = meetings.filter(
            (m) =>
              m.tenantId === args.where.tenantId &&
              m.linkedCycleId !== null &&
              args.where.linkedCycleId.in.includes(m.linkedCycleId),
          );
          const grouped = new Map<string, number>();
          for (const m of matched) {
            grouped.set(m.linkedCycleId!, (grouped.get(m.linkedCycleId!) ?? 0) + 1);
          }
          return Array.from(grouped).map(([linkedCycleId, count]) => ({
            linkedCycleId,
            _count: { _all: count },
          }));
        },
      ),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: prisma.project.findUnique,
          // tx.project.findFirst используется в generateProjectIdentifier
          // (поиск по {tenantId, identifier}); должен видеть СВЕЖИЕ inserts
          // из самой транзакции (Прима делает это естественно, в моке —
          // явный поиск по массиву projects).
          findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
            const where = args.where;
            return (
              projects.find((p) => {
                if (where.tenantId !== undefined && p.tenantId !== where.tenantId) return false;
                if (where.identifier !== undefined && p.identifier !== where.identifier) return false;
                if (where.id !== undefined && p.id !== where.id) return false;
                return true;
              }) ?? null
            );
          }),
          create: vi.fn(
            async (args: { data: Partial<ProjectRow>; select?: Record<string, true> }) => {
              const id = nid('project');
              const row: ProjectRow = {
                id,
                tenantId: (args.data.tenantId as string) ?? '',
                slug: (args.data.slug as string) ?? '',
                identifier: (args.data.identifier as string) ?? '',
                name: (args.data.name as string) ?? '',
                ownerId: (args.data.ownerId as string) ?? '',
                network: (args.data.network as number) ?? 0,
                timezone: (args.data.timezone as string) ?? 'Europe/Moscow',
                cycleViewEnabled: true,
                intakeViewEnabled: true,
                customerCardId: (args.data.customerCardId as string | null) ?? null,
                vendorId: (args.data.vendorId as string | null) ?? null,
                subjectPersonId: (args.data.subjectPersonId as string | null) ?? null,
                departmentId: (args.data.departmentId as string | null) ?? null,
                defaultStateId: null,
                deletedAt: null,
              };
              projects.push(row);
              if (args.select) {
                return {
                  id: row.id,
                  identifier: row.identifier,
                  slug: row.slug,
                };
              }
              return row;
            },
          ),
          update: vi.fn(async () => undefined),
        },
        issueState: {
          createManyAndReturn: vi.fn(
            async (args: {
              data: Array<{
                tenantId: string;
                projectId: string;
                category: string;
                isDefault: boolean;
              }>;
            }) => {
              const created = args.data.map((d) => ({
                id: nid('state'),
                ...d,
              }));
              issueStates.push(...created);
              return created.map((s) => ({ id: s.id, isDefault: s.isDefault }));
            },
          ),
        },
        projectMember: {
          create: vi.fn(
            async (args: {
              data: { projectId: string; userId: string };
            }) => {
              projectMembers.push(args.data);
              return args.data;
            },
          ),
        },
        board: {
          create: vi.fn(
            async (args: {
              data: { tenantId: string; projectId: string; name: string; isDefault: boolean };
            }) => {
              const id = nid('board');
              boards.push({ id, ...args.data });
              return { id };
            },
          ),
        },
        cycle: {
          create: vi.fn(
            async (args: {
              data: {
                tenantId: string;
                projectId: string;
                name: string;
                startDate: Date;
                endDate: Date;
                timezone: string;
              };
            }) => {
              const id = nid('cycle');
              const now = new Date();
              const row: CycleRow = {
                id,
                ...args.data,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              };
              cycles.push(row);
              return { id };
            },
          ),
        },
      };
      return cb(tx);
    }),
  };

  return {
    prisma,
    db: { cards, vendors, persons, departments, projects, cycles, issues, hints, meetings, issueStates, boards, projectMembers },
    nid,
  };
}

// ────────────────────────── Тесты ──────────────────────────

describe('Sprints integration — list', () => {
  it('1. status=active отдаёт только active спринты', async () => {
    const { prisma, db, nid } = buildFakeDb();
    const now = new Date('2026-06-01T00:00:00Z');
    // setup: project в Org A
    const project = {
      id: nid('p'),
      tenantId: TENANT_A,
      slug: 'p',
      identifier: 'P',
      name: 'Project',
      ownerId: 'u-1',
      network: 0,
      timezone: 'Europe/Moscow',
      cycleViewEnabled: true,
      intakeViewEnabled: true,
      customerCardId: null,
      vendorId: null,
      subjectPersonId: null,
      departmentId: null,
      defaultStateId: null,
      deletedAt: null,
    };
    db.projects.push(project);
    // active cycle
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: project.id,
      name: 'Active',
      startDate: new Date(now.getTime() - 86400_000),
      endDate: new Date(now.getTime() + 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    // completed cycle
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: project.id,
      name: 'Completed',
      startDate: new Date(now.getTime() - 30 * 86400_000),
      endDate: new Date(now.getTime() - 16 * 86400_000),
      completedAt: new Date(now.getTime() - 15 * 86400_000),
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    // future cycle
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: project.id,
      name: 'Future',
      startDate: new Date(now.getTime() + 30 * 86400_000),
      endDate: new Date(now.getTime() + 44 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });

    const svc = new SprintsService(prisma as never, {} as never);
    vi.setSystemTime(now);
    const res = await svc.list({
      tenantId: TENANT_A,
      query: {
        status: 'active',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.name).toBe('Active');
    expect(res.items[0]!.status).toBe('active');
    vi.useRealTimers();
  });

  it('2. scopeKind=customer фильтрует по project.customerCardId', async () => {
    const { prisma, db, nid } = buildFakeDb();
    // 2 проекта: один с customer, один без
    const cardId = nid('card');
    db.cards.push({ id: cardId, tenantId: TENANT_A, name: 'Альфа', deletedAt: null });
    const pWithCustomer = {
      id: nid('p'),
      tenantId: TENANT_A,
      slug: 'cust',
      identifier: 'CST',
      name: 'Клиент: Альфа',
      ownerId: 'u-1',
      network: 0,
      timezone: 'Europe/Moscow',
      cycleViewEnabled: true,
      intakeViewEnabled: true,
      customerCardId: cardId,
      vendorId: null,
      subjectPersonId: null,
      departmentId: null,
      defaultStateId: null,
      deletedAt: null,
    };
    db.projects.push(pWithCustomer);
    const pOrg = { ...pWithCustomer, id: nid('p'), slug: 'org', identifier: 'ORG', customerCardId: null };
    db.projects.push(pOrg);
    const now = new Date();
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: pWithCustomer.id,
      name: 'Sprint A',
      startDate: now,
      endDate: new Date(now.getTime() + 14 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: pOrg.id,
      name: 'Sprint Org',
      startDate: now,
      endDate: new Date(now.getTime() + 14 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });

    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.list({
      tenantId: TENANT_A,
      query: {
        status: 'all',
        scopeKind: 'customer',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.name).toBe('Sprint A');
    expect(res.items[0]!.scope.kind).toBe('customer');
    expect(res.items[0]!.scope.label).toBe('Клиент: Альфа');
  });

  it('3. q="маркетинг" — попадает по project.name', async () => {
    const { prisma, db, nid } = buildFakeDb();
    const p1 = {
      id: nid('p'),
      tenantId: TENANT_A,
      slug: 'mkt',
      identifier: 'MKT',
      name: 'Отдел: Маркетинг',
      ownerId: 'u-1',
      network: 0,
      timezone: 'Europe/Moscow',
      cycleViewEnabled: true,
      intakeViewEnabled: true,
      customerCardId: null,
      vendorId: null,
      subjectPersonId: null,
      departmentId: 'd-marketing',
      defaultStateId: null,
      deletedAt: null,
    };
    db.projects.push(p1);
    db.departments.push({
      id: 'd-marketing',
      tenantId: TENANT_A,
      name: 'Маркетинг',
      deletedAt: null,
    });
    const now = new Date();
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: p1.id,
      name: 'Спринт',
      startDate: now,
      endDate: new Date(now.getTime() + 14 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.list({
      tenantId: TENANT_A,
      query: {
        status: 'all',
        q: 'маркетинг',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.scope.kind).toBe('department');
  });

  it('4. sortBy=hints — critical-первые', async () => {
    const { prisma, db, nid } = buildFakeDb();
    const now = new Date();
    const project: ProjectRow = {
      id: nid('p'),
      tenantId: TENANT_A,
      slug: 'p',
      identifier: 'P',
      name: 'Project',
      ownerId: 'u-1',
      network: 0,
      timezone: 'Europe/Moscow',
      cycleViewEnabled: true,
      intakeViewEnabled: true,
      customerCardId: null,
      vendorId: null,
      subjectPersonId: null,
      departmentId: null,
      defaultStateId: null,
      deletedAt: null,
    };
    db.projects.push(project);
    const cId1 = nid('c');
    const cId2 = nid('c');
    db.cycles.push({
      id: cId1,
      tenantId: TENANT_A,
      projectId: project.id,
      name: 'Без critical',
      startDate: now,
      endDate: new Date(now.getTime() + 14 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    db.cycles.push({
      id: cId2,
      tenantId: TENANT_A,
      projectId: project.id,
      name: 'С critical',
      startDate: now,
      endDate: new Date(now.getTime() + 14 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    db.hints.push({
      id: nid('h'),
      tenantId: TENANT_A,
      cycleId: cId2,
      severity: 'critical',
      status: 'active',
    });
    db.hints.push({
      id: nid('h'),
      tenantId: TENANT_A,
      cycleId: cId1,
      severity: 'info',
      status: 'active',
    });

    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.list({
      tenantId: TENANT_A,
      query: {
        status: 'all',
        sortBy: 'hints',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items[0]!.name).toBe('С critical');
    expect(res.items[0]!.criticalHintsCount).toBe(1);
    expect(res.items[1]!.criticalHintsCount).toBe(0);
  });

  it('7. soft-deleted Card → scope.isDeleted=true, спринт всё ещё виден', async () => {
    const { prisma, db, nid } = buildFakeDb();
    const cardId = nid('card');
    db.cards.push({
      id: cardId,
      tenantId: TENANT_A,
      name: 'Бывший клиент',
      deletedAt: new Date(),
    });
    const project: ProjectRow = {
      id: nid('p'),
      tenantId: TENANT_A,
      slug: 'p',
      identifier: 'P',
      name: 'Клиент: Бывший клиент',
      ownerId: 'u-1',
      network: 0,
      timezone: 'Europe/Moscow',
      cycleViewEnabled: true,
      intakeViewEnabled: true,
      customerCardId: cardId,
      vendorId: null,
      subjectPersonId: null,
      departmentId: null,
      defaultStateId: null,
      deletedAt: null,
    };
    db.projects.push(project);
    const now = new Date();
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: project.id,
      name: 'Sprint',
      startDate: now,
      endDate: new Date(now.getTime() + 14 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.list({
      tenantId: TENANT_A,
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.scope.kind).toBe('customer');
    expect(res.items[0]!.scope.isDeleted).toBe(true);
    expect(res.items[0]!.scope.label).toBe('Клиент: Бывший клиент (удалён)');
  });

  it('8. tenant isolation: Org B видит свои спринты, Org A не видит чужие', async () => {
    const { prisma, db, nid } = buildFakeDb();
    const pA: ProjectRow = {
      id: nid('p'),
      tenantId: TENANT_A,
      slug: 'a',
      identifier: 'A',
      name: 'A',
      ownerId: 'u-1',
      network: 0,
      timezone: 'Europe/Moscow',
      cycleViewEnabled: true,
      intakeViewEnabled: true,
      customerCardId: null,
      vendorId: null,
      subjectPersonId: null,
      departmentId: null,
      defaultStateId: null,
      deletedAt: null,
    };
    const pB: ProjectRow = { ...pA, id: nid('p'), tenantId: TENANT_B, slug: 'b', identifier: 'B', name: 'B' };
    db.projects.push(pA, pB);
    const now = new Date();
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_A,
      projectId: pA.id,
      name: 'A-cycle',
      startDate: now,
      endDate: new Date(now.getTime() + 7 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });
    db.cycles.push({
      id: nid('c'),
      tenantId: TENANT_B,
      projectId: pB.id,
      name: 'B-cycle',
      startDate: now,
      endDate: new Date(now.getTime() + 7 * 86400_000),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      timezone: 'Europe/Moscow',
    });

    const svc = new SprintsService(prisma as never, {} as never);
    const resA = await svc.list({
      tenantId: TENANT_A,
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(resA.items).toHaveLength(1);
    expect(resA.items[0]!.name).toBe('A-cycle');

    const resB = await svc.list({
      tenantId: TENANT_B,
      query: {
        status: 'all',
        sortBy: 'startDate',
        sortDir: 'desc',
        page: 1,
        limit: 20,
      },
    });
    expect(resB.items).toHaveLength(1);
    expect(resB.items[0]!.name).toBe('B-cycle');
  });
});

describe('Sprints integration — quickCreate', () => {
  it('5. scope=customer создаёт Project + Cycle + Board + 4 States атомарно', async () => {
    const { prisma, db } = buildFakeDb();
    const cardId = 'card-1';
    db.cards.push({ id: cardId, tenantId: TENANT_A, name: 'Тест Альфа', deletedAt: null });

    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.quickCreate({
      tenantId: TENANT_A,
      userId: 'u-1',
      dto: {
        scope: 'customer',
        refId: cardId,
        sprintName: 'Тест Альфа',
        durationDays: 14,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });

    expect(res.projectId).toBeDefined();
    expect(res.cycleId).toBeDefined();
    expect(res.projectIdentifier).toBeDefined();
    expect(res.projectSlug).toBeDefined();

    expect(db.projects).toHaveLength(1);
    expect(db.projects[0]!.customerCardId).toBe(cardId);
    expect(db.projects[0]!.name).toBe('Клиент: Тест Альфа');

    expect(db.cycles).toHaveLength(1);
    expect(db.cycles[0]!.name).toBe('Тест Альфа');
    expect(db.cycles[0]!.tenantId).toBe(TENANT_A);

    expect(db.boards).toHaveLength(1);
    expect(db.boards[0]!.isDefault).toBe(true);

    expect(db.issueStates).toHaveLength(4);
    expect(db.issueStates.filter((s) => s.isDefault).length).toBe(1);

    expect(db.projectMembers).toHaveLength(1);
  });

  it('6. Повторный quick-create с тем же именем — другой identifier (collision retry)', async () => {
    const { prisma, db } = buildFakeDb();
    const cardId = 'card-1';
    db.cards.push({ id: cardId, tenantId: TENANT_A, name: 'Альфа', deletedAt: null });

    const svc = new SprintsService(prisma as never, {} as never);
    const res1 = await svc.quickCreate({
      tenantId: TENANT_A,
      userId: 'u-1',
      dto: {
        scope: 'customer',
        refId: cardId,
        sprintName: 'Sprint 1',
        durationDays: 14,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    const res2 = await svc.quickCreate({
      tenantId: TENANT_A,
      userId: 'u-1',
      dto: {
        scope: 'customer',
        refId: cardId,
        sprintName: 'Sprint 2',
        durationDays: 14,
        startDate: '2026-06-15',
        timezone: 'Europe/Moscow',
      },
    });
    // оба проекта-спринта — с уникальными slug и identifier
    expect(res1.projectSlug).not.toBe(res2.projectSlug);
    expect(res1.projectIdentifier).not.toBe(res2.projectIdentifier);
  });

  it('refId не существует → NotFoundException', async () => {
    const { prisma } = buildFakeDb();
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: TENANT_A,
        userId: 'u-1',
        dto: {
          scope: 'customer',
          refId: 'missing-card',
          sprintName: 'Sprint',
          durationDays: 7,
          startDate: '2026-06-01',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refId из другого tenant → NotFoundException', async () => {
    const { prisma, db } = buildFakeDb();
    db.cards.push({
      id: 'card-other',
      tenantId: TENANT_B,
      name: 'Чужая карточка',
      deletedAt: null,
    });
    const svc = new SprintsService(prisma as never, {} as never);
    await expect(
      svc.quickCreate({
        tenantId: TENANT_A,
        userId: 'u-1',
        dto: {
          scope: 'customer',
          refId: 'card-other',
          sprintName: 'Sprint',
          durationDays: 7,
          startDate: '2026-06-01',
          timezone: 'Europe/Moscow',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quick-create с scope=org — без refId, Project без scope-полей', async () => {
    const { prisma, db } = buildFakeDb();
    const svc = new SprintsService(prisma as never, {} as never);
    const res = await svc.quickCreate({
      tenantId: TENANT_A,
      userId: 'u-1',
      dto: {
        scope: 'org',
        sprintName: 'Спринт компании',
        durationDays: 7,
        startDate: '2026-06-01',
        timezone: 'Europe/Moscow',
      },
    });
    expect(res.projectId).toBeDefined();
    expect(db.projects[0]!.customerCardId).toBeNull();
    expect(db.projects[0]!.vendorId).toBeNull();
    expect(db.projects[0]!.subjectPersonId).toBeNull();
    expect(db.projects[0]!.departmentId).toBeNull();
  });
});
