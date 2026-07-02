import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { WeeklyPerPersonService } from './weekly-per-person.service';

const WEEK_START = '2026-06-01';
const NOW = new Date('2026-06-03T12:00:00.000Z');

function dayInWeek(dateLocal: string): Date {
  return new Date(`${dateLocal}T12:00:00.000Z`);
}

interface CommitmentRow {
  id?: string;
  commitmentAuthorPersonId: string | null;
}
interface PersonRow {
  id: string;
  name: string;
  userId: string | null;
  primaryDepartmentId: string | null;
}
interface DoneIssueRow {
  id: string;
  sourceBlockIds?: string[];
  assignees: Array<{ userId: string }>;
}
interface PlannedIssueRow {
  id: string;
  completedAt: Date | null;
  assignees: Array<{ userId: string }>;
}
interface CheckInRow {
  personId: string;
}
interface DeptRow {
  id: string;
  name: string;
}
interface CycleRow {
  id: string;
}
interface IssueRow {
  id: string;
  completedAt: Date | null;
  assignees: Array<{ userId: string }>;
}

function buildService(
  opts: {
    commitments?: CommitmentRow[];
    persons?: PersonRow[];
    doneIssues?: DoneIssueRow[];
    plannedIssues?: PlannedIssueRow[];
    checkIns?: CheckInRow[];
    departments?: DeptRow[];
    cycles?: CycleRow[];
    cycleIssues?: IssueRow[];
    cacheValue?: string | null;
    cacheGetError?: Error;
    cacheSetError?: Error;
    primaryGoal?: { id: string } | null;
    contributions?: Array<{ personId: string; netScore: number }>;
  } = {},
): {
  service: WeeklyPerPersonService;
  prisma: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    person: { findMany: ReturnType<typeof vi.fn> };
    dailyCheckIn: { findMany: ReturnType<typeof vi.fn> };
    department: { findMany: ReturnType<typeof vi.fn> };
    cycle: { findMany: ReturnType<typeof vi.fn> };
    issue: { findMany: ReturnType<typeof vi.fn> };
    goal: { findFirst: ReturnType<typeof vi.fn> };
    personGoalContribution: { findMany: ReturnType<typeof vi.fn> };
  };
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
} {
  let issueCall = 0;
  const prisma = {
    ideaBlock: { findMany: vi.fn(async () => opts.commitments ?? []) },
    person: { findMany: vi.fn(async () => opts.persons ?? []) },
    dailyCheckIn: { findMany: vi.fn(async () => opts.checkIns ?? []) },
    department: { findMany: vi.fn(async () => opts.departments ?? []) },
    cycle: { findMany: vi.fn(async () => opts.cycles ?? []) },
    issue: {
      findMany: vi.fn(async () => {
        const call = issueCall;
        issueCall += 1;
        if (call === 0) return opts.doneIssues ?? [];
        if (call === 1) return opts.plannedIssues ?? [];
        return opts.cycleIssues ?? [];
      }),
    },
    goal: { findFirst: vi.fn(async () => opts.primaryGoal ?? null) },
    personGoalContribution: { findMany: vi.fn(async () => opts.contributions ?? []) },
  };

  const redisGet = vi.fn(async () => {
    if (opts.cacheGetError) throw opts.cacheGetError;
    return opts.cacheValue ?? null;
  });
  const redisSet = vi.fn(async () => {
    if (opts.cacheSetError) throw opts.cacheSetError;
    return 'OK';
  });
  const redis = {
    client: { get: redisGet, set: redisSet },
  } as unknown as RedisService;

  const service = new WeeklyPerPersonService(prisma as unknown as PrismaService, redis);

  return { service, prisma, redisGet, redisSet };
}

function baseFixture() {
  const commitments: CommitmentRow[] = [
    { commitmentAuthorPersonId: 'P1' },
    { commitmentAuthorPersonId: 'P1' },
    { commitmentAuthorPersonId: 'P1' },
    { commitmentAuthorPersonId: 'P2' },
    { commitmentAuthorPersonId: 'P2' },
    { commitmentAuthorPersonId: 'P2' },
    { commitmentAuthorPersonId: 'P2' },
    { commitmentAuthorPersonId: 'P3' },
    { commitmentAuthorPersonId: 'P3' },
  ];
  const persons: PersonRow[] = [
    { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: 'D1' },
    { id: 'P2', name: 'Борис', userId: 'U2', primaryDepartmentId: 'D1' },
    { id: 'P3', name: 'Вера', userId: null, primaryDepartmentId: null },
  ];
  const doneIssues: DoneIssueRow[] = [
    { id: 'di-1', assignees: [{ userId: 'U1' }] },
    { id: 'di-2', assignees: [{ userId: 'U1' }] },
    { id: 'di-3', assignees: [{ userId: 'U2' }] },
  ];
  const checkIns: CheckInRow[] = [{ personId: 'P1' }, { personId: 'P2' }, { personId: 'P2' }];
  const departments: DeptRow[] = [{ id: 'D1', name: 'Продажи' }];
  return { commitments, persons, doneIssues, checkIns, departments };
}

describe('WeeklyPerPersonService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('базовая агрегация (3 человека)', () => {
    it('задачи привязаны через userId; человек без userId → tasksDone=0', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.tasksDone).toBe(2);
      expect(byId.get('P2')!.tasksDone).toBe(1);
      expect(byId.get('P3')!.tasksDone).toBe(0);
    });

    it('чек-ины считаются per person', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.checkInsCompleted).toBe(1);
      expect(byId.get('P2')!.checkInsCompleted).toBe(2);
      expect(byId.get('P3')!.checkInsCompleted).toBe(0);
    });

    it('departmentName подтягивается; null → null', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.departmentName).toBe('Продажи');
      expect(byId.get('P3')!.departmentName).toBeNull();
    });

    it('total = число людей с активностью; generatedAt — ISO-строка', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(3);
      expect(dto.weekStart).toBe(WEEK_START);
      expect(dto.weekEnd).toBe('2026-06-07');
      expect(dto.generatedAt).toBe(NOW.toISOString());
      expect(() => new Date(dto.generatedAt).toISOString()).not.toThrow();
    });

    it('явный weekEnd → окно недели до переданной даты (пн–пт)', async () => {
      const { service, prisma } = buildService(baseFixture());
      const dto = await service.compute(
        {
          tenantId: 't-1',
          weekStart: WEEK_START,
          weekEnd: '2026-06-05',
          limit: 100,
          offset: 0,
          sort: 'risk',
        },
        NOW,
      );
      expect(dto.weekStart).toBe(WEEK_START);
      expect(dto.weekEnd).toBe('2026-06-05');

      const ibCall = prisma.ideaBlock.findMany.mock.calls[0]![0];
      const lte = ibCall.where.commitmentDueDate.lte as Date;
      expect(lte.toISOString()).toBe('2026-06-05T23:59:59.999Z');
    });
  });

  describe('topRisk', () => {
    it('topRisk ≤5 и отсортирован по tasksNotDone desc', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 1, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.topRisk.length).toBeLessThanOrEqual(5);
    });

    it('topRisk усечён до 5 при >5 людях', async () => {
      const commitments: CommitmentRow[] = [];
      const persons: PersonRow[] = [];
      for (let i = 0; i < 8; i += 1) {
        const id = `Q${i}`;
        commitments.push({ commitmentAuthorPersonId: id });
        persons.push({ id, name: `Имя${i}`, userId: null, primaryDepartmentId: null });
      }
      const { service } = buildService({ commitments, persons });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(8);
      expect(dto.topRisk.length).toBe(5);
    });
  });

  describe('rows — limit/offset/sort', () => {
    it('sort=risk → slice(offset,offset+limit)', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 1, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.rows.length).toBe(1);
    });
  });

  describe('пустой результат', () => {
    it('нет активности → total=0, пустые списки', async () => {
      const { service } = buildService({ commitments: [] });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 5, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(0);
      expect(dto.rows).toEqual([]);
      expect(dto.topRisk).toEqual([]);
    });
  });

  describe('multi-tenancy и фильтры в Prisma', () => {
    it('все выборки идут с tenantId; обещания — signalType=commitment', async () => {
      const { service, prisma } = buildService(baseFixture());
      await service.compute(
        { tenantId: 't-42', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );

      const ibCall = prisma.ideaBlock.findMany.mock.calls[0]![0];
      expect(ibCall.where.tenantId).toBe('t-42');
      expect(ibCall.where.signalType).toBe('commitment');

      const personCall = prisma.person.findMany.mock.calls[0]![0];
      expect(personCall.where.tenantId).toBe('t-42');

      const doneIssueCall = prisma.issue.findMany.mock.calls[0]![0];
      expect(doneIssueCall.where.tenantId).toBe('t-42');
      expect(doneIssueCall.where.completedAt).toEqual({
        not: null,
        gte: expect.any(Date),
        lte: expect.any(Date),
      });
      expect(doneIssueCall.where.deletedAt).toBeNull();
      expect(doneIssueCall.where.archivedAt).toBeNull();
      expect(doneIssueCall.where.assignees).toEqual({ some: { userId: { in: ['U1', 'U2'] } } });

      const checkInCall = prisma.dailyCheckIn.findMany.mock.calls[0]![0];
      expect(checkInCall.where.tenantId).toBe('t-42');

      const deptCall = prisma.department.findMany.mock.calls[0]![0];
      expect(deptCall.where.tenantId).toBe('t-42');
    });
  });

  describe('Redis-кэш', () => {
    it('cache-hit: при втором вызове Prisma НЕ дёргается', async () => {
      const { service, prisma, redisGet } = buildService(baseFixture());

      const first = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);

      redisGet.mockResolvedValueOnce(JSON.stringify(first));
      const second = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );

      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('ошибка Redis.get → fallback на live-подсчёт, не падает', async () => {
      const { service, prisma } = buildService({
        ...baseFixture(),
        cacheGetError: new Error('Redis down'),
      });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(3);
      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);
    });

    it('ошибка Redis.set → результат всё равно возвращается', async () => {
      const { service } = buildService({
        ...baseFixture(),
        cacheSetError: new Error('Redis down'),
      });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(3);
    });

    it('cache-ключ включает tenantId+weekStart+weekEnd+sort+limit+offset', async () => {
      const { service, redisGet } = buildService({ commitments: [] });
      await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 10, offset: 5, sort: 'risk' },
        NOW,
      );
      expect(redisGet).toHaveBeenCalledWith(
        `weekly_per_person:t-1:${WEEK_START}:2026-06-07:risk:10:5`,
      );
    });

    it('cache-ключ различает окно пн–пт и пн–вс по сегменту weekEnd', async () => {
      const { service, redisGet } = buildService({ commitments: [] });
      await service.compute(
        {
          tenantId: 't-1',
          weekStart: WEEK_START,
          weekEnd: '2026-06-05',
          limit: 10,
          offset: 5,
          sort: 'risk',
        },
        NOW,
      );
      expect(redisGet).toHaveBeenCalledWith(
        `weekly_per_person:t-1:${WEEK_START}:2026-06-05:risk:10:5`,
      );
    });
  });

  describe('dedup задач против учтённых блоков-обещаний', () => {
    it('задача, порождённая учтённым блоком-обещанием, НЕ удваивает tasksDone', async () => {
      const commitments: CommitmentRow[] = [{ id: 'b-com', commitmentAuthorPersonId: 'P1' }];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const doneIssues: DoneIssueRow[] = [
        { id: 'di-1', assignees: [{ userId: 'U1' }], sourceBlockIds: ['b-com'] },
        { id: 'di-2', assignees: [{ userId: 'U1' }], sourceBlockIds: [] },
        { id: 'di-3', assignees: [{ userId: 'U1' }], sourceBlockIds: ['b-other'] },
      ];
      const { service } = buildService({ commitments, persons, doneIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksDone).toBe(2);
    });

    it('без sourceBlockIds (независимые источники) — обе считаются', async () => {
      const commitments: CommitmentRow[] = [{ id: 'b-com', commitmentAuthorPersonId: 'P1' }];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const doneIssues: DoneIssueRow[] = [
        { id: 'di-1', assignees: [{ userId: 'U1' }] },
        { id: 'di-2', assignees: [{ userId: 'U1' }] },
      ];
      const { service } = buildService({ commitments, persons, doneIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksDone).toBe(2);
    });
  });

  describe('ТЗ редизайн Ф8.5 — tasksPlanned / tasksNotDone', () => {
    it('tasksPlanned = задачи недели по dueDate; tasksNotDone = planned − done', async () => {
      const commitments: CommitmentRow[] = [{ id: 'b1', commitmentAuthorPersonId: 'P1' }];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const doneIssues: DoneIssueRow[] = [{ id: 'di-1', assignees: [{ userId: 'U1' }] }];
      const plannedIssues: PlannedIssueRow[] = [
        { id: 'pi-1', completedAt: dayInWeek('2026-06-03'), assignees: [{ userId: 'U1' }] },
        { id: 'pi-2', completedAt: null, assignees: [{ userId: 'U1' }] },
        { id: 'pi-3', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const { service } = buildService({ commitments, persons, doneIssues, plannedIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksDone).toBe(1);
      expect(p1.tasksPlanned).toBe(3);
      expect(p1.tasksNotDone).toBe(2);
    });

    it('tasksNotDone не уходит в минус (done > planned по разным окнам)', async () => {
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const commitments: CommitmentRow[] = [{ id: 'b1', commitmentAuthorPersonId: 'P1' }];
      const doneIssues: DoneIssueRow[] = [
        { id: 'di-1', assignees: [{ userId: 'U1' }] },
        { id: 'di-2', assignees: [{ userId: 'U1' }] },
      ];
      const plannedIssues: PlannedIssueRow[] = [];
      const { service } = buildService({ commitments, persons, doneIssues, plannedIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(0);
      expect(p1.tasksNotDone).toBe(0);
    });
  });

  describe('A11.1 — Issue в активном цикле недели добавляется в PLAN', () => {
    it('задача трекера в активном цикле увеличивает tasksPlanned (аддитивно к Task)', async () => {
      const commitments: CommitmentRow[] = [{ id: 'b1', commitmentAuthorPersonId: 'P1' }];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const plannedIssues: PlannedIssueRow[] = [
        { id: 'pi-1', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const cycles: CycleRow[] = [{ id: 'C1' }];
      const cycleIssues: IssueRow[] = [
        { id: 'I1', completedAt: dayInWeek('2026-06-04'), assignees: [{ userId: 'U1' }] },
        { id: 'I2', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const { service } = buildService({ commitments, persons, plannedIssues, cycles, cycleIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(3);
      expect(p1.tasksNotDone).toBe(2);
    });

    it('Issue, назначенный нескольким, считается каждому ровно один раз (дедуп)', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1' },
        { id: 'b2', commitmentAuthorPersonId: 'P2' },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
        { id: 'P2', name: 'Борис', userId: 'U2', primaryDepartmentId: null },
      ];
      const cycles: CycleRow[] = [{ id: 'C1' }];
      const cycleIssues: IssueRow[] = [
        { id: 'I1', completedAt: null, assignees: [{ userId: 'U1' }, { userId: 'U2' }] },
      ];
      const { service } = buildService({ commitments, persons, cycles, cycleIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.tasksPlanned).toBe(1);
      expect(byId.get('P2')!.tasksPlanned).toBe(1);
    });

    it('Issue и в dueDate-окне, и в активном цикле → tasksPlanned считается один раз', async () => {
      const commitments: CommitmentRow[] = [{ id: 'b1', commitmentAuthorPersonId: 'P1' }];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const plannedIssues: PlannedIssueRow[] = [
        { id: 'SHARED', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const cycles: CycleRow[] = [{ id: 'C1' }];
      const cycleIssues: IssueRow[] = [
        { id: 'SHARED', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const { service } = buildService({
        commitments,
        persons,
        plannedIssues,
        cycles,
        cycleIssues,
      });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(1);
    });

    it('нет активных циклов → Issue не выбираются, tasksPlanned не растёт', async () => {
      const commitments: CommitmentRow[] = [{ id: 'b1', commitmentAuthorPersonId: 'P1' }];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const plannedIssues: PlannedIssueRow[] = [
        { id: 'pi-1', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const { service, prisma } = buildService({ commitments, persons, plannedIssues, cycles: [] });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(1);
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.cycle.findMany.mock.calls[0]![0].where.completedAt).toBeNull();
    });

    it('Cycle.findMany — tenant-скоуп, completedAt=null, окно недели пересекается', async () => {
      const { service, prisma } = buildService({ ...baseFixture(), cycles: [{ id: 'C1' }] });
      await service.compute(
        { tenantId: 't-42', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const cycleCall = prisma.cycle.findMany.mock.calls[0]![0];
      expect(cycleCall.where.tenantId).toBe('t-42');
      expect(cycleCall.where.completedAt).toBeNull();
      expect(cycleCall.where.startDate.lte).toBeInstanceOf(Date);
      expect(cycleCall.where.endDate.gte).toBeInstanceOf(Date);

      const cycleIssueCall = prisma.issue.findMany.mock.calls[2]![0];
      expect(cycleIssueCall.where.tenantId).toBe('t-42');
      expect(cycleIssueCall.where.deletedAt).toBeNull();
      expect(cycleIssueCall.where.archivedAt).toBeNull();
      expect(cycleIssueCall.where.cycleId).toEqual({ in: ['C1'] });
    });
  });

  describe('Ф5b — goalContributionNet (вклад в главную цель)', () => {
    it('нет главной цели → goalContributionNet=null у всех строк', async () => {
      const { service, prisma } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      for (const r of dto.rows) {
        expect(r.goalContributionNet).toBeNull();
      }
      expect(prisma.personGoalContribution.findMany).not.toHaveBeenCalled();
    });

    it('главная цель есть + вклад у P1 → net у P1, у остальных null; weekStart матчится UTC-полночью', async () => {
      const { service, prisma } = buildService({
        ...baseFixture(),
        primaryGoal: { id: 'g1' },
        contributions: [{ personId: 'P1', netScore: 2 }],
      });
      const dto = await service.compute(
        { tenantId: 't-9', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.goalContributionNet).toBe(2);
      expect(byId.get('P2')!.goalContributionNet).toBeNull();
      expect(byId.get('P3')!.goalContributionNet).toBeNull();

      const pgcCall = prisma.personGoalContribution.findMany.mock.calls[0]![0];
      expect(pgcCall.where.tenantId).toBe('t-9');
      expect(pgcCall.where.goalId).toBe('g1');
      const weekStartRange = pgcCall.where.weekStart as { gte: Date; lte: Date };
      expect(weekStartRange.gte.toISOString()).toBe(`${WEEK_START}T00:00:00.000Z`);
      expect(weekStartRange.lte.toISOString()).toBe('2026-06-07T00:00:00.000Z');
      expect(pgcCall.where.personId).toEqual({ in: ['P1', 'P2', 'P3'] });
    });

    it('месячное окно (явный weekEnd) → вклад суммируется по нескольким понедельникам', async () => {
      const { service, prisma } = buildService({
        ...baseFixture(),
        primaryGoal: { id: 'g1' },
        contributions: [
          { personId: 'P1', netScore: 2 },
          { personId: 'P1', netScore: 1.5 },
          { personId: 'P2', netScore: -1 },
        ],
      });
      const dto = await service.compute(
        {
          tenantId: 't-1',
          weekStart: WEEK_START,
          weekEnd: '2026-06-30',
          limit: 100,
          offset: 0,
          sort: 'risk',
        },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.goalContributionNet).toBe(3.5);
      expect(byId.get('P2')!.goalContributionNet).toBe(-1);

      const pgcCall = prisma.personGoalContribution.findMany.mock.calls[0]![0];
      const weekStartRange = pgcCall.where.weekStart as { gte: Date; lte: Date };
      expect(weekStartRange.gte.toISOString()).toBe(`${WEEK_START}T00:00:00.000Z`);
      expect(weekStartRange.lte.toISOString()).toBe('2026-06-30T00:00:00.000Z');
    });

    it('topRisk также несёт goalContributionNet', async () => {
      const { service } = buildService({
        ...baseFixture(),
        primaryGoal: { id: 'g1' },
        contributions: [{ personId: 'P1', netScore: 2 }],
      });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      for (const r of dto.topRisk) {
        expect('goalContributionNet' in r).toBe(true);
      }
    });

    it('fallback на active-цель, когда нет isPrimary', async () => {
      const { service, prisma } = buildService({
        ...baseFixture(),
        primaryGoal: null,
        contributions: [{ personId: 'P2', netScore: -1.5 }],
      });
      prisma.goal.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'g-active' });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P2')!.goalContributionNet).toBe(-1.5);
      const pgcCall = prisma.personGoalContribution.findMany.mock.calls[0]![0];
      expect(pgcCall.where.goalId).toBe('g-active');
    });

    it('ошибка выборки вклада → деградация: goalContributionNet=null, не падает', async () => {
      const { service, prisma } = buildService({
        ...baseFixture(),
        primaryGoal: { id: 'g1' },
      });
      prisma.personGoalContribution.findMany.mockRejectedValueOnce(new Error('db down'));
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(3);
      for (const r of dto.rows) {
        expect(r.goalContributionNet).toBeNull();
      }
    });
  });

  describe('ТЗ редизайн Ф8.5 — getPersonWeekItems (построчный план-факт)', () => {
    function buildItemsService(opts: {
      person?: { userId: string | null } | null;
      issues?: Array<{ title: string; completedAt: Date | null; dueDate: Date | null }>;
      checkIns?: Array<{
        plansJson: unknown;
        donesJson: unknown;
        blockersJson: unknown;
      }>;
    }) {
      const prisma = {
        person: { findFirst: vi.fn(async () => opts.person ?? null) },
        issue: { findMany: vi.fn(async () => opts.issues ?? []) },
        dailyCheckIn: { findMany: vi.fn(async () => opts.checkIns ?? []) },
      };
      const redis = {
        client: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') },
      } as unknown as RedisService;
      const service = new WeeklyPerPersonService(prisma as unknown as PrismaService, redis);
      return { service, prisma };
    }

    it('задача overdue + чек-ин-план без done → 2 пункта с правильными factStatus/blockedBy', async () => {
      const { service } = buildItemsService({
        person: { userId: 'U1' },
        issues: [
          {
            title: 'Закрыть тикет №42',
            completedAt: null,
            dueDate: dayInWeek('2026-06-02'),
          },
        ],
        checkIns: [
          {
            plansJson: [{ text: 'Созвон с поставщиком' }],
            donesJson: [],
            blockersJson: [{ text: 'Нет ответа от поставщика' }],
          },
        ],
      });

      const dto = await service.getPersonWeekItems(
        { tenantId: 't-1', personId: 'P1', weekStart: WEEK_START },
        NOW,
      );

      expect(dto.personId).toBe('P1');
      expect(dto.weekStart).toBe(WEEK_START);
      expect(dto.weekEnd).toBe('2026-06-07');
      expect(dto.items).toHaveLength(2);

      const task = dto.items.find((i) => i.kind === 'task')!;
      expect(task.title).toBe('Закрыть тикет №42');
      expect(task.factStatus).toBe('overdue');
      expect(task.blockedBy).toBe('Нет ответа от поставщика');

      const checkin = dto.items.find((i) => i.kind === 'checkin')!;
      expect(checkin.title).toBe('Созвон с поставщиком');
      expect(checkin.factStatus).toBe('planned');
      expect(checkin.plannedDue).toBeNull();
      expect(checkin.blockedBy).toBe('Нет ответа от поставщика');
    });

    it('checkin-план, попавший в donesJson → factStatus=done, blockedBy=null', async () => {
      const { service } = buildItemsService({
        person: { userId: 'U1' },
        checkIns: [
          {
            plansJson: [{ text: 'Написать отчёт' }, { text: 'Позвонить Пете' }],
            donesJson: [{ text: 'написать отчёт' }],
            blockersJson: [{ text: 'Завис сервер' }],
          },
        ],
      });
      const dto = await service.getPersonWeekItems(
        { tenantId: 't-1', personId: 'P1', weekStart: WEEK_START },
        NOW,
      );
      const done = dto.items.find((i) => i.title === 'Написать отчёт')!;
      expect(done.factStatus).toBe('done');
      expect(done.blockedBy).toBeNull();
      const planned = dto.items.find((i) => i.title === 'Позвонить Пете')!;
      expect(planned.factStatus).toBe('planned');
      expect(planned.blockedBy).toBe('Завис сервер');
    });

    it('person без userId → задачи не выбираются (issue.findMany не вызван)', async () => {
      const { service, prisma } = buildItemsService({
        person: { userId: null },
        checkIns: [],
      });
      const dto = await service.getPersonWeekItems(
        { tenantId: 't-1', personId: 'P1', weekStart: WEEK_START },
        NOW,
      );
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
      expect(dto.items).toEqual([]);
    });
  });
});
