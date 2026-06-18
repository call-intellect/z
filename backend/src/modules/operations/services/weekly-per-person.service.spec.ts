import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
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
  commitmentStatus: string | null;
  commitmentDueDate: Date | null;
}
interface PersonRow {
  id: string;
  name: string;
  userId: string | null;
  primaryDepartmentId: string | null;
}
interface TaskRow {
  assigneeUserId: string | null;
  evidenceBlockIds?: string[];
  status?: string;
  dueDate?: Date | null;
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
    tasks?: TaskRow[];
    plannedTasks?: TaskRow[];
    checkIns?: CheckInRow[];
    departments?: DeptRow[];
    cycles?: CycleRow[];
    cycleIssues?: IssueRow[];
    cacheValue?: string | null;
    cacheGetError?: Error;
    cacheSetError?: Error;
    minDenom?: number;
  } = {},
): {
  service: WeeklyPerPersonService;
  prisma: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    person: { findMany: ReturnType<typeof vi.fn> };
    task: { findMany: ReturnType<typeof vi.fn> };
    dailyCheckIn: { findMany: ReturnType<typeof vi.fn> };
    department: { findMany: ReturnType<typeof vi.fn> };
    cycle: { findMany: ReturnType<typeof vi.fn> };
    issue: { findMany: ReturnType<typeof vi.fn> };
  };
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
  noAnswerCalls: Array<{ tenantTop: string; noAnswerTotal: number }>;
} {
  let taskCall = 0;
  const prisma = {
    ideaBlock: { findMany: vi.fn(async () => opts.commitments ?? []) },
    person: { findMany: vi.fn(async () => opts.persons ?? []) },
    task: {
      findMany: vi.fn(async () => {
        const isPlanned = taskCall === 1;
        taskCall += 1;
        if (isPlanned) return opts.plannedTasks ?? opts.tasks ?? [];
        return opts.tasks ?? [];
      }),
    },
    dailyCheckIn: { findMany: vi.fn(async () => opts.checkIns ?? []) },
    department: { findMany: vi.fn(async () => opts.departments ?? []) },
    cycle: { findMany: vi.fn(async () => opts.cycles ?? []) },
    issue: { findMany: vi.fn(async () => opts.cycleIssues ?? []) },
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

  const cfg = {
    getDynamic: vi.fn(async () => opts.minDenom ?? 1),
  } as unknown as TypedConfigService;

  const noAnswerCalls: Array<{ tenantTop: string; noAnswerTotal: number }> = [];
  const metrics = {
    recordWeeklyPerPersonCompute: vi.fn((args: { tenantTop: string; noAnswerTotal: number }) => {
      noAnswerCalls.push(args);
    }),
    incWeeklyPerPersonSelfViewServed: vi.fn(),
  } as unknown as BusinessMetricsService;

  const service = new WeeklyPerPersonService(
    prisma as unknown as PrismaService,
    redis,
    cfg,
    metrics,
  );

  return { service, prisma, redisGet, redisSet, noAnswerCalls };
}

function baseFixture() {
  const commitments: CommitmentRow[] = [
    {
      commitmentAuthorPersonId: 'P1',
      commitmentStatus: 'fulfilled',
      commitmentDueDate: dayInWeek('2026-06-02'),
    },
    {
      commitmentAuthorPersonId: 'P1',
      commitmentStatus: 'fulfilled',
      commitmentDueDate: dayInWeek('2026-06-02'),
    },
    {
      commitmentAuthorPersonId: 'P1',
      commitmentStatus: 'fulfilled',
      commitmentDueDate: dayInWeek('2026-06-03'),
    },
    {
      commitmentAuthorPersonId: 'P2',
      commitmentStatus: 'fulfilled',
      commitmentDueDate: dayInWeek('2026-06-01'),
    },
    {
      commitmentAuthorPersonId: 'P2',
      commitmentStatus: 'missed',
      commitmentDueDate: dayInWeek('2026-06-01'),
    },
    {
      commitmentAuthorPersonId: 'P2',
      commitmentStatus: 'missed',
      commitmentDueDate: dayInWeek('2026-06-02'),
    },
    {
      commitmentAuthorPersonId: 'P2',
      commitmentStatus: 'open',
      commitmentDueDate: dayInWeek('2026-06-02'),
    },
    {
      commitmentAuthorPersonId: 'P3',
      commitmentStatus: 'missed',
      commitmentDueDate: dayInWeek('2026-06-01'),
    },
    {
      commitmentAuthorPersonId: 'P3',
      commitmentStatus: 'asked',
      commitmentDueDate: dayInWeek('2026-06-02'),
    },
  ];
  const persons: PersonRow[] = [
    { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: 'D1' },
    { id: 'P2', name: 'Борис', userId: 'U2', primaryDepartmentId: 'D1' },
    { id: 'P3', name: 'Вера', userId: null, primaryDepartmentId: null },
  ];
  const tasks: TaskRow[] = [
    { assigneeUserId: 'U1' },
    { assigneeUserId: 'U1' },
    { assigneeUserId: 'U2' },
  ];
  const checkIns: CheckInRow[] = [{ personId: 'P1' }, { personId: 'P2' }, { personId: 'P2' }];
  const departments: DeptRow[] = [{ id: 'D1', name: 'Продажи' }];
  return { commitments, persons, tasks, checkIns, departments };
}

describe('WeeklyPerPersonService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('базовая агрегация (3 человека)', () => {
    it('reliabilityPercent корректен по каждому человеку', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );

      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.reliabilityPercent).toBe(100);
      expect(byId.get('P1')!.promisesGiven).toBe(3);
      expect(byId.get('P2')!.reliabilityPercent).toBe(25);
      expect(byId.get('P2')!.promisesBroken).toBe(2);
      expect(byId.get('P2')!.promisesOverdue).toBe(1);
      expect(byId.get('P3')!.reliabilityPercent).toBe(0);
      expect(byId.get('P3')!.promisesOverdue).toBe(1);
    });

    it('задачи привязаны через userId; человек без userId → tasksDone=0', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
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
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
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
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.departmentName).toBe('Продажи');
      expect(byId.get('P3')!.departmentName).toBeNull();
    });

    it('total = число людей с активностью; generatedAt — ISO-строка', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(dto.total).toBe(3);
      expect(dto.weekStart).toBe(WEEK_START);
      expect(dto.weekEnd).toBe('2026-06-07');
      expect(dto.generatedAt).toBe(NOW.toISOString());
      expect(() => new Date(dto.generatedAt).toISOString()).not.toThrow();
    });
  });

  describe('R8 — деление на ноль', () => {
    it('человек только с pendingActive (open, будущий due) → reliabilityPercent=null', async () => {
      const commitments: CommitmentRow[] = [
        {
          commitmentAuthorPersonId: 'P9',
          commitmentStatus: 'open',
          commitmentDueDate: dayInWeek('2026-06-06'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P9', name: 'Пётр', userId: null, primaryDepartmentId: null },
      ];
      const { service } = buildService({ commitments, persons });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p9 = dto.rows.find((r) => r.personId === 'P9')!;
      expect(p9.promisesGiven).toBe(1);
      expect(p9.promisesKept).toBe(0);
      expect(p9.promisesOverdue).toBe(0);
      expect(p9.reliabilityPercent).toBeNull();
    });
  });

  describe('topReliable / topRisk', () => {
    it('topReliable ≤5 и отсортирован по reliability desc', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 1, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(dto.topReliable.length).toBeLessThanOrEqual(5);
      expect(dto.topReliable.map((r) => r.personId)).toEqual(['P1', 'P2', 'P3']);
      expect(dto.topReliable.length).toBe(3);
    });

    it('topRisk ≤5 и отсортирован по (broken+overdue) desc', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 1, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(dto.topRisk.length).toBeLessThanOrEqual(5);
      expect(dto.topRisk.map((r) => r.personId)).toEqual(['P2', 'P3', 'P1']);
    });

    it('top-списки усечены до 5 при >5 людях', async () => {
      const commitments: CommitmentRow[] = [];
      const persons: PersonRow[] = [];
      for (let i = 0; i < 8; i += 1) {
        const id = `Q${i}`;
        commitments.push({
          commitmentAuthorPersonId: id,
          commitmentStatus: 'missed',
          commitmentDueDate: dayInWeek('2026-06-02'),
        });
        persons.push({ id, name: `Имя${i}`, userId: null, primaryDepartmentId: null });
      }
      const { service } = buildService({ commitments, persons });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.total).toBe(8);
      expect(dto.topReliable.length).toBe(5);
      expect(dto.topRisk.length).toBe(5);
    });
  });

  describe('rows — limit/offset/sort', () => {
    it('sort=reliability → reliability desc, slice(offset,offset+limit)', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 1, offset: 1, sort: 'reliability' },
        NOW,
      );
      expect(dto.rows.map((r) => r.personId)).toEqual(['P2']);
    });

    it('sort=risk → (broken+overdue) desc', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 2, offset: 0, sort: 'risk' },
        NOW,
      );
      expect(dto.rows.map((r) => r.personId)).toEqual(['P2', 'P3']);
    });
  });

  describe('пустой результат', () => {
    it('нет активности → total=0, пустые списки', async () => {
      const { service } = buildService({ commitments: [] });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 5, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(dto.total).toBe(0);
      expect(dto.rows).toEqual([]);
      expect(dto.topReliable).toEqual([]);
      expect(dto.topRisk).toEqual([]);
    });
  });

  describe('multi-tenancy и фильтры в Prisma', () => {
    it('все выборки идут с tenantId; обещания — author не null, signalType=commitment', async () => {
      const { service, prisma } = buildService(baseFixture());
      await service.compute(
        { tenantId: 't-42', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );

      const ibCall = prisma.ideaBlock.findMany.mock.calls[0]![0];
      expect(ibCall.where.tenantId).toBe('t-42');
      expect(ibCall.where.signalType).toBe('commitment');
      expect(ibCall.where.commitmentAuthorPersonId).toEqual({ not: null });
      expect(ibCall.where.OR).toEqual([
        { commitmentRecipientPersonId: { not: null } },
        { commitmentDueDate: { not: null } },
      ]);

      const personCall = prisma.person.findMany.mock.calls[0]![0];
      expect(personCall.where.tenantId).toBe('t-42');

      const taskCall = prisma.task.findMany.mock.calls[0]![0];
      expect(taskCall.where.tenantId).toBe('t-42');
      expect(taskCall.where.status).toBe('done');

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
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(prisma.ideaBlock.findMany).toHaveBeenCalledTimes(1);

      redisGet.mockResolvedValueOnce(JSON.stringify(first));
      const second = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
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
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
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
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(dto.total).toBe(3);
    });

    it('cache-ключ включает tenantId+weekStart+sort+limit+offset', async () => {
      const { service, redisGet } = buildService({ commitments: [] });
      await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 10, offset: 5, sort: 'risk' },
        NOW,
      );
      expect(redisGet).toHaveBeenCalledWith(`weekly_per_person:t-1:${WEEK_START}:risk:10:5`);
    });
  });

  describe('ТЗ-2 Ф4 — promisesNoAnswer (commitmentStatus=asked)', () => {
    it('считает asked-обещания отдельным счётчиком, в дополнение к overdue', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'asked',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
        {
          id: 'b2',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'asked',
          commitmentDueDate: dayInWeek('2026-06-06'),
        },
        {
          id: 'b3',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'open',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const { service } = buildService({ commitments, persons });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.promisesNoAnswer).toBe(2);
      expect(p1.promisesOverdue).toBe(2);
    });

    it('метрика recordWeeklyPerPersonCompute получает сумму noAnswer', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'asked',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
        {
          id: 'b2',
          commitmentAuthorPersonId: 'P2',
          commitmentStatus: 'asked',
          commitmentDueDate: dayInWeek('2026-06-03'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'A', userId: null, primaryDepartmentId: null },
        { id: 'P2', name: 'B', userId: null, primaryDepartmentId: null },
      ];
      const { service, noAnswerCalls } = buildService({ commitments, persons });
      await service.compute(
        { tenantId: 't-7', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(noAnswerCalls.length).toBe(1);
      expect(noAnswerCalls[0]!.noAnswerTotal).toBe(2);
      expect(typeof noAnswerCalls[0]!.tenantTop).toBe('string');
    });
  });

  describe('ТЗ-2 Ф4 — denom-guard (reliability.min_denominator)', () => {
    it('знаменатель < minDenom → reliabilityPercent=null («мало данных»)', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
        {
          id: 'b2',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'missed',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: null, primaryDepartmentId: null },
      ];
      const { service } = buildService({ commitments, persons, minDenom: 3 });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.promisesKept).toBe(1);
      expect(p1.promisesBroken).toBe(1);
      expect(p1.reliabilityPercent).toBeNull();
    });

    it('знаменатель >= minDenom → процент считается', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
        {
          id: 'b2',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
        {
          id: 'b3',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'missed',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: null, primaryDepartmentId: null },
      ];
      const { service } = buildService({ commitments, persons, minDenom: 3 });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.reliabilityPercent).toBe(67);
    });
  });

  describe('ТЗ-2 Ф4 — dedup задач против учтённых обещаний', () => {
    it('задача, порождённая учтённым блоком-обещанием, НЕ удваивает tasksDone', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b-com',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const tasks: TaskRow[] = [
        { assigneeUserId: 'U1', evidenceBlockIds: ['b-com'] },
        { assigneeUserId: 'U1', evidenceBlockIds: [] },
        { assigneeUserId: 'U1', evidenceBlockIds: ['b-other'] },
      ];
      const { service } = buildService({ commitments, persons, tasks });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.promisesGiven).toBe(1);
      expect(p1.tasksDone).toBe(2);
    });

    it('без evidenceBlockIds (независимые источники) — обе считаются', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b-com',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const tasks: TaskRow[] = [{ assigneeUserId: 'U1' }, { assigneeUserId: 'U1' }];
      const { service } = buildService({ commitments, persons, tasks });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.promisesGiven).toBe(1);
      expect(p1.promisesKept).toBe(1);
      expect(p1.tasksDone).toBe(2);
    });
  });

  describe('ТЗ редизайн Ф8.5 — tasksPlanned / tasksNotDone', () => {
    it('tasksPlanned = задачи недели по dueDate; tasksNotDone = planned − done', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const tasks: TaskRow[] = [{ assigneeUserId: 'U1', status: 'done' }];
      const plannedTasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'done', dueDate: dayInWeek('2026-06-03') },
        { assigneeUserId: 'U1', status: 'open', dueDate: dayInWeek('2026-06-04') },
        { assigneeUserId: 'U1', status: 'open', dueDate: dayInWeek('2026-06-05') },
      ];
      const { service } = buildService({ commitments, persons, tasks, plannedTasks });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
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
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'open',
          commitmentDueDate: dayInWeek('2026-06-06'),
        },
      ];
      const tasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'done' },
        { assigneeUserId: 'U1', status: 'done' },
      ];
      const plannedTasks: TaskRow[] = [];
      const { service } = buildService({ commitments, persons, tasks, plannedTasks });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(0);
      expect(p1.tasksNotDone).toBe(0);
    });
  });

  describe('A11.1 — Issue в активном цикле недели добавляется в PLAN', () => {
    it('задача трекера в активном цикле увеличивает tasksPlanned (аддитивно к Task)', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const plannedTasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'open', dueDate: dayInWeek('2026-06-03') },
      ];
      const cycles: CycleRow[] = [{ id: 'C1' }];
      const cycleIssues: IssueRow[] = [
        { id: 'I1', completedAt: dayInWeek('2026-06-04'), assignees: [{ userId: 'U1' }] },
        { id: 'I2', completedAt: null, assignees: [{ userId: 'U1' }] },
      ];
      const { service } = buildService({ commitments, persons, plannedTasks, cycles, cycleIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(3);
      expect(p1.tasksNotDone).toBe(2);
    });

    it('Issue, назначенный нескольким, считается каждому ровно один раз (дедуп)', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
        {
          id: 'b2',
          commitmentAuthorPersonId: 'P2',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
        { id: 'P2', name: 'Борис', userId: 'U2', primaryDepartmentId: null },
      ];
      const plannedTasks: TaskRow[] = [];
      const cycles: CycleRow[] = [{ id: 'C1' }];
      const cycleIssues: IssueRow[] = [
        { id: 'I1', completedAt: null, assignees: [{ userId: 'U1' }, { userId: 'U2' }] },
      ];
      const { service } = buildService({ commitments, persons, plannedTasks, cycles, cycleIssues });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const byId = new Map(dto.rows.map((r) => [r.personId, r]));
      expect(byId.get('P1')!.tasksPlanned).toBe(1);
      expect(byId.get('P2')!.tasksPlanned).toBe(1);
    });

    it('нет активных циклов → Issue не выбираются, tasksPlanned не растёт', async () => {
      const commitments: CommitmentRow[] = [
        {
          id: 'b1',
          commitmentAuthorPersonId: 'P1',
          commitmentStatus: 'fulfilled',
          commitmentDueDate: dayInWeek('2026-06-02'),
        },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const plannedTasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'open', dueDate: dayInWeek('2026-06-03') },
      ];
      const { service, prisma } = buildService({ commitments, persons, plannedTasks, cycles: [] });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(1);
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('Cycle.findMany — tenant-скоуп, completedAt=null, окно недели пересекается', async () => {
      const { service, prisma } = buildService({ ...baseFixture(), cycles: [{ id: 'C1' }] });
      await service.compute(
        { tenantId: 't-42', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const cycleCall = prisma.cycle.findMany.mock.calls[0]![0];
      expect(cycleCall.where.tenantId).toBe('t-42');
      expect(cycleCall.where.completedAt).toBeNull();
      expect(cycleCall.where.startDate.lte).toBeInstanceOf(Date);
      expect(cycleCall.where.endDate.gte).toBeInstanceOf(Date);

      const issueCall = prisma.issue.findMany.mock.calls[0]![0];
      expect(issueCall.where.tenantId).toBe('t-42');
      expect(issueCall.where.deletedAt).toBeNull();
      expect(issueCall.where.archivedAt).toBeNull();
      expect(issueCall.where.cycleId).toEqual({ in: ['C1'] });
    });
  });

  describe('ТЗ редизайн Ф8.5 — getPersonWeekItems (построчный план-факт)', () => {
    function buildItemsService(opts: {
      person?: { userId: string | null } | null;
      commitments?: Array<{
        name: string;
        commitmentStatus: string | null;
        commitmentDueDate: Date | null;
      }>;
      tasks?: Array<{ title: string; status: string; dueDate: Date | null }>;
      checkIns?: Array<{
        plansJson: unknown;
        donesJson: unknown;
        blockersJson: unknown;
      }>;
    }) {
      const prisma = {
        person: { findFirst: vi.fn(async () => opts.person ?? null) },
        ideaBlock: { findMany: vi.fn(async () => opts.commitments ?? []) },
        task: { findMany: vi.fn(async () => opts.tasks ?? []) },
        dailyCheckIn: { findMany: vi.fn(async () => opts.checkIns ?? []) },
      };
      const redis = {
        client: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') },
      } as unknown as RedisService;
      const cfg = {
        getDynamic: vi.fn(async () => 1),
      } as unknown as TypedConfigService;
      const metrics = {
        recordWeeklyPerPersonCompute: vi.fn(),
        incWeeklyPerPersonSelfViewServed: vi.fn(),
      } as unknown as BusinessMetricsService;
      const service = new WeeklyPerPersonService(
        prisma as unknown as PrismaService,
        redis,
        cfg,
        metrics,
      );
      return { service, prisma };
    }

    it('обещание fulfilled + задача overdue + чек-ин-план без done → 3 пункта с правильными factStatus/blockedBy', async () => {
      const { service } = buildItemsService({
        person: { userId: 'U1' },
        commitments: [
          {
            name: 'Подготовить КП клиенту',
            commitmentStatus: 'fulfilled',
            commitmentDueDate: dayInWeek('2026-06-02'),
          },
        ],
        tasks: [
          {
            title: 'Закрыть тикет №42',
            status: 'open',
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
      expect(dto.items).toHaveLength(3);

      const commitment = dto.items.find((i) => i.kind === 'commitment')!;
      expect(commitment.title).toBe('Подготовить КП клиенту');
      expect(commitment.factStatus).toBe('fulfilled');
      expect(commitment.plannedDue).toBe(dayInWeek('2026-06-02').toISOString());
      expect(commitment.blockedBy).toBeNull();

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

    it('commitment missed → factStatus=missed + blockedBy; open с прошлым due → overdue', async () => {
      const { service } = buildItemsService({
        person: { userId: 'U1' },
        commitments: [
          {
            name: 'Сорванное обещание',
            commitmentStatus: 'missed',
            commitmentDueDate: dayInWeek('2026-06-01'),
          },
          {
            name: 'Просроченное открытое',
            commitmentStatus: 'open',
            commitmentDueDate: dayInWeek('2026-06-02'),
          },
          {
            name: 'Ещё не наступило',
            commitmentStatus: 'open',
            commitmentDueDate: dayInWeek('2026-06-06'),
          },
        ],
        checkIns: [{ plansJson: [], donesJson: [], blockersJson: [{ text: 'Болезнь' }] }],
      });
      const dto = await service.getPersonWeekItems(
        { tenantId: 't-1', personId: 'P1', weekStart: WEEK_START },
        NOW,
      );
      const missed = dto.items.find((i) => i.title === 'Сорванное обещание')!;
      expect(missed.factStatus).toBe('missed');
      expect(missed.blockedBy).toBe('Болезнь');
      const overdue = dto.items.find((i) => i.title === 'Просроченное открытое')!;
      expect(overdue.factStatus).toBe('overdue');
      const open = dto.items.find((i) => i.title === 'Ещё не наступило')!;
      expect(open.factStatus).toBe('open');
      expect(open.blockedBy).toBeNull();
    });

    it('person без userId → задачи не выбираются (task.findMany не вызван)', async () => {
      const { service, prisma } = buildItemsService({
        person: { userId: null },
        commitments: [],
        checkIns: [],
      });
      const dto = await service.getPersonWeekItems(
        { tenantId: 't-1', personId: 'P1', weekStart: WEEK_START },
        NOW,
      );
      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(dto.items).toEqual([]);
    });
  });
});
