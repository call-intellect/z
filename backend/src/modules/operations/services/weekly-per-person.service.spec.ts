/**
 * Unit-тесты `WeeklyPerPersonService` (ТЗ-D Фаза 4).
 *
 * БД-независимые: мок Prisma (ideaBlock/person/task/dailyCheckIn/department
 * findMany) + Redis через vi.fn (паттерн `commitment-reliability.service.spec`).
 *
 * Покрывают:
 *   - корректность reliabilityPercent (kept / (kept+broken+overdue) * 100);
 *   - человек с 0 обещаний-знаменателя → reliabilityPercent=null (R8);
 *   - overdue считается только для open/asked с прошлым due (относительно now);
 *   - topReliable ≤5, отсортирован по reliability desc;
 *   - topRisk ≤5, отсортирован по (broken+overdue) desc;
 *   - rows respects limit/offset/sort;
 *   - total = число людей с активностью;
 *   - generatedAt — ISO-строка;
 *   - кэш-hit (второй вызов не дёргает Prisma) и graceful fallback при ошибке;
 *   - задачи привязываются к человеку через userId; человек без userId → 0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { WeeklyPerPersonService } from './weekly-per-person.service';

const WEEK_START = '2026-06-01'; // понедельник
// now — внутри недели (среда), чтобы open/asked с прошлым due был overdue.
const NOW = new Date('2026-06-03T12:00:00.000Z');

/** YYYY-MM-DD внутри недели → Date (полдень UTC). */
function dayInWeek(dateLocal: string): Date {
  return new Date(`${dateLocal}T12:00:00.000Z`);
}

interface CommitmentRow {
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
}
interface CheckInRow {
  personId: string;
}
interface DeptRow {
  id: string;
  name: string;
}

function buildService(opts: {
  commitments?: CommitmentRow[];
  persons?: PersonRow[];
  tasks?: TaskRow[];
  checkIns?: CheckInRow[];
  departments?: DeptRow[];
  cacheValue?: string | null;
  cacheGetError?: Error;
  cacheSetError?: Error;
} = {}): {
  service: WeeklyPerPersonService;
  prisma: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    person: { findMany: ReturnType<typeof vi.fn> };
    task: { findMany: ReturnType<typeof vi.fn> };
    dailyCheckIn: { findMany: ReturnType<typeof vi.fn> };
    department: { findMany: ReturnType<typeof vi.fn> };
  };
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    ideaBlock: { findMany: vi.fn(async () => opts.commitments ?? []) },
    person: { findMany: vi.fn(async () => opts.persons ?? []) },
    task: { findMany: vi.fn(async () => opts.tasks ?? []) },
    dailyCheckIn: { findMany: vi.fn(async () => opts.checkIns ?? []) },
    department: { findMany: vi.fn(async () => opts.departments ?? []) },
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

  const service = new WeeklyPerPersonService(
    prisma as unknown as PrismaService,
    redis,
  );

  return { service, prisma, redisGet, redisSet };
}

/**
 * Фикстура: 3 человека с разными kept/broken/overdue/tasks/checkins.
 *   P1 — 3 kept, 0 broken, 0 overdue → 100%, 2 задачи, 1 чек-ин.
 *   P2 — 1 kept, 2 broken, 1 overdue (open+прошлый due) → 25%, risk=3.
 *   P3 — 0 kept, 1 broken, 1 overdue → 0%, risk=2, без userId (задачи=0).
 */
function baseFixture() {
  const commitments: CommitmentRow[] = [
    // P1: 3 fulfilled
    { commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
    { commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
    { commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-03') },
    // P2: 1 fulfilled, 2 missed, 1 open с прошлым due (overdue)
    { commitmentAuthorPersonId: 'P2', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-01') },
    { commitmentAuthorPersonId: 'P2', commitmentStatus: 'missed', commitmentDueDate: dayInWeek('2026-06-01') },
    { commitmentAuthorPersonId: 'P2', commitmentStatus: 'missed', commitmentDueDate: dayInWeek('2026-06-02') },
    { commitmentAuthorPersonId: 'P2', commitmentStatus: 'open', commitmentDueDate: dayInWeek('2026-06-02') }, // due<now → overdue
    // P3: 1 missed, 1 asked с прошлым due (overdue) — 0 kept
    { commitmentAuthorPersonId: 'P3', commitmentStatus: 'missed', commitmentDueDate: dayInWeek('2026-06-01') },
    { commitmentAuthorPersonId: 'P3', commitmentStatus: 'asked', commitmentDueDate: dayInWeek('2026-06-02') },
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
      // P1: 3 kept / 3 = 100
      expect(byId.get('P1')!.reliabilityPercent).toBe(100);
      expect(byId.get('P1')!.promisesGiven).toBe(3);
      // P2: 1 / (1+2+1) = 25
      expect(byId.get('P2')!.reliabilityPercent).toBe(25);
      expect(byId.get('P2')!.promisesBroken).toBe(2);
      expect(byId.get('P2')!.promisesOverdue).toBe(1);
      // P3: 0 / (0+1+1) = 0
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
      expect(byId.get('P1')!.tasksDone).toBe(2); // 2 задачи U1
      expect(byId.get('P2')!.tasksDone).toBe(1); // 1 задача U2
      expect(byId.get('P3')!.tasksDone).toBe(0); // нет userId
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
      expect(dto.weekEnd).toBe('2026-06-07'); // воскресенье
      expect(dto.generatedAt).toBe(NOW.toISOString());
      expect(() => new Date(dto.generatedAt).toISOString()).not.toThrow();
    });
  });

  describe('R8 — деление на ноль', () => {
    it('человек только с pendingActive (open, будущий due) → reliabilityPercent=null', async () => {
      const commitments: CommitmentRow[] = [
        // due в будущем (но в пределах недели — вс) → open не overdue, знаменатель=0
        { commitmentAuthorPersonId: 'P9', commitmentStatus: 'open', commitmentDueDate: dayInWeek('2026-06-06') },
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
      expect(p9.reliabilityPercent).toBeNull(); // НЕ 0
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
      // P1(100) > P2(25) > P3(0)
      expect(dto.topReliable.map((r) => r.personId)).toEqual(['P1', 'P2', 'P3']);
      // считается от ПОЛНОГО множества, не от страницы (limit=1)
      expect(dto.topReliable.length).toBe(3);
    });

    it('topRisk ≤5 и отсортирован по (broken+overdue) desc', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 1, offset: 0, sort: 'reliability' },
        NOW,
      );
      expect(dto.topRisk.length).toBeLessThanOrEqual(5);
      // P2 risk=3 > P3 risk=2 > P1 risk=0
      expect(dto.topRisk.map((r) => r.personId)).toEqual(['P2', 'P3', 'P1']);
    });

    it('top-списки усечены до 5 при >5 людях', async () => {
      const commitments: CommitmentRow[] = [];
      const persons: PersonRow[] = [];
      for (let i = 0; i < 8; i += 1) {
        const id = `Q${i}`;
        // у каждого 1 missed → risk=1, reliability=0
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
      // полный порядок [P1,P2,P3]; offset=1,limit=1 → [P2]
      expect(dto.rows.map((r) => r.personId)).toEqual(['P2']);
    });

    it('sort=risk → (broken+overdue) desc', async () => {
      const { service } = buildService(baseFixture());
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 2, offset: 0, sort: 'risk' },
        NOW,
      );
      // порядок риска [P2,P3,P1]; limit=2 → [P2,P3]
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
      expect(redisGet).toHaveBeenCalledWith(
        `weekly_per_person:t-1:${WEEK_START}:risk:10:5`,
      );
    });
  });
});
