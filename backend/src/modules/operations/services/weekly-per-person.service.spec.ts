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

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
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
/** A11.1 — активный цикл недели. */
interface CycleRow {
  id: string;
}
/** A11.1 — задача трекера в цикле (исполнители — M:M через assignees). */
interface IssueRow {
  id: string;
  completedAt: Date | null;
  assignees: Array<{ userId: string }>;
}

function buildService(opts: {
  commitments?: CommitmentRow[];
  persons?: PersonRow[];
  tasks?: TaskRow[];
  /**
   * ТЗ редизайн Ф8.5 — отдельный набор для ВТОРОГО `task.findMany` (план по
   * dueDate). Если не задан — используется `tasks` (как для done-выборки).
   * Первый вызов — done-задачи, второй — планируемые.
   */
  plannedTasks?: TaskRow[];
  checkIns?: CheckInRow[];
  departments?: DeptRow[];
  /** A11.1 — активные циклы недели (Cycle.findMany). */
  cycles?: CycleRow[];
  /** A11.1 — задачи трекера в активных циклах (Issue.findMany). */
  cycleIssues?: IssueRow[];
  cacheValue?: string | null;
  cacheGetError?: Error;
  cacheSetError?: Error;
  /**
   * min_denominator для reliability. Дефолт 1 — чтобы существующие тесты вели
   * себя как раньше (null только при знаменателе=0). Тесты ТЗ-2 Ф4 «мало
   * данных» прокидывают 3.
   */
  minDenom?: number;
} = {}): {
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
  // task.findMany вызывается дважды в computeFromDb: [0]=done, [1]=planned.
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
    // A11.1 — задачи трекера в активном цикле недели (план по циклу).
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
    recordWeeklyPerPersonCompute: vi.fn(
      (args: { tenantTop: string; noAnswerTotal: number }) => {
        noAnswerCalls.push(args);
      },
    ),
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
      // ТЗ редизайн Ф7б (Б-3) — полный предикат полноты (не только автор):
      // OR(адресат, срок) подмешан через completeCommitmentWhere().
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
      expect(redisGet).toHaveBeenCalledWith(
        `weekly_per_person:t-1:${WEEK_START}:risk:10:5`,
      );
    });
  });

  // ──────────────────────────── ТЗ-2 Ф4 ────────────────────────────────

  describe('ТЗ-2 Ф4 — promisesNoAnswer (commitmentStatus=asked)', () => {
    it('считает asked-обещания отдельным счётчиком, в дополнение к overdue', async () => {
      const commitments: CommitmentRow[] = [
        // asked с прошлым due → и noAnswer, и overdue
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'asked', commitmentDueDate: dayInWeek('2026-06-02') },
        // asked с будущим due → noAnswer, но НЕ overdue
        { id: 'b2', commitmentAuthorPersonId: 'P1', commitmentStatus: 'asked', commitmentDueDate: dayInWeek('2026-06-06') },
        // open → не noAnswer
        { id: 'b3', commitmentAuthorPersonId: 'P1', commitmentStatus: 'open', commitmentDueDate: dayInWeek('2026-06-02') },
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
      expect(p1.promisesNoAnswer).toBe(2); // b1 + b2
      // overdue не изменился: b1 (asked,прошлый) + b3 (open,прошлый) = 2
      expect(p1.promisesOverdue).toBe(2);
    });

    it('метрика recordWeeklyPerPersonCompute получает сумму noAnswer', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'asked', commitmentDueDate: dayInWeek('2026-06-02') },
        { id: 'b2', commitmentAuthorPersonId: 'P2', commitmentStatus: 'asked', commitmentDueDate: dayInWeek('2026-06-03') },
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
      // P1: 1 kept, 1 broken → denom=2; при minDenom=3 → null.
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
        { id: 'b2', commitmentAuthorPersonId: 'P1', commitmentStatus: 'missed', commitmentDueDate: dayInWeek('2026-06-02') },
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
      expect(p1.reliabilityPercent).toBeNull(); // denom=2 < 3
    });

    it('знаменатель >= minDenom → процент считается', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
        { id: 'b2', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
        { id: 'b3', commitmentAuthorPersonId: 'P1', commitmentStatus: 'missed', commitmentDueDate: dayInWeek('2026-06-02') },
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
      expect(p1.reliabilityPercent).toBe(67); // 2/3 = 66.7 → 67
    });
  });

  describe('ТЗ-2 Ф4 — dedup задач против учтённых обещаний', () => {
    it('задача, порождённая учтённым блоком-обещанием, НЕ удваивает tasksDone', async () => {
      // P1: одно обещание (block 'b-com') учтено в promisesGiven.
      const commitments: CommitmentRow[] = [
        { id: 'b-com', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const tasks: TaskRow[] = [
        // эта задача порождена тем же блоком-обещанием → НЕ считаем
        { assigneeUserId: 'U1', evidenceBlockIds: ['b-com'] },
        // независимая задача (legacy / другой источник) → считаем
        { assigneeUserId: 'U1', evidenceBlockIds: [] },
        // задача от чужого блока → считаем
        { assigneeUserId: 'U1', evidenceBlockIds: ['b-other'] },
      ];
      const { service } = buildService({ commitments, persons, tasks });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.promisesGiven).toBe(1);
      expect(p1.tasksDone).toBe(2); // 3 задачи − 1 дубль обещания
    });

    it('без evidenceBlockIds (независимые источники) — обе считаются', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b-com', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const tasks: TaskRow[] = [
        { assigneeUserId: 'U1' },
        { assigneeUserId: 'U1' },
      ];
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

  // ───────────────────── ТЗ редизайн Ф8.5 — свод tasksPlanned/tasksNotDone ──

  describe('ТЗ редизайн Ф8.5 — tasksPlanned / tasksNotDone', () => {
    it('tasksPlanned = задачи недели по dueDate; tasksNotDone = planned − done', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      // done-выборка (по updatedAt): одна закрытая задача → tasksDone=1.
      const tasks: TaskRow[] = [{ assigneeUserId: 'U1', status: 'done' }];
      // planned-выборка (по dueDate): 3 задачи на неделю, из них 1 done.
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
      expect(p1.tasksNotDone).toBe(2); // 3 planned − 1 done(among planned)
    });

    it('tasksNotDone не уходит в минус (done > planned по разным окнам)', async () => {
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'open', commitmentDueDate: dayInWeek('2026-06-06') },
      ];
      const tasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'done' },
        { assigneeUserId: 'U1', status: 'done' },
      ];
      const plannedTasks: TaskRow[] = []; // ни одной задачи со сроком на неделю
      const { service } = buildService({ commitments, persons, tasks, plannedTasks });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(0);
      expect(p1.tasksNotDone).toBe(0); // max(0, 0 − 0)
    });
  });

  // ─────────────── A11.1 — задачи трекера (Issue) в активном цикле недели ────

  describe('A11.1 — Issue в активном цикле недели добавляется в PLAN', () => {
    it('задача трекера в активном цикле увеличивает tasksPlanned (аддитивно к Task)', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      // Task-план по сроку: 1 задача (open).
      const plannedTasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'open', dueDate: dayInWeek('2026-06-03') },
      ];
      // Issue в активном цикле: 2 задачи (одна done, одна нет) — план по циклу.
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
      // 1 Task-план + 2 Issue = 3 запланировано.
      expect(p1.tasksPlanned).toBe(3);
      // Сделано из плана: Task open(0) + Issue done(1) = 1 → notDone = 3 − 1 = 2.
      expect(p1.tasksNotDone).toBe(2);
    });

    it('Issue, назначенный нескольким, считается каждому ровно один раз (дедуп)', async () => {
      const commitments: CommitmentRow[] = [
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
        { id: 'b2', commitmentAuthorPersonId: 'P2', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
        { id: 'P2', name: 'Борис', userId: 'U2', primaryDepartmentId: null },
      ];
      const plannedTasks: TaskRow[] = []; // только Issue-план
      const cycles: CycleRow[] = [{ id: 'C1' }];
      const cycleIssues: IssueRow[] = [
        // один Issue на двух исполнителей → по 1 каждому
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
        { id: 'b1', commitmentAuthorPersonId: 'P1', commitmentStatus: 'fulfilled', commitmentDueDate: dayInWeek('2026-06-02') },
      ];
      const persons: PersonRow[] = [
        { id: 'P1', name: 'Алиса', userId: 'U1', primaryDepartmentId: null },
      ];
      const plannedTasks: TaskRow[] = [
        { assigneeUserId: 'U1', status: 'open', dueDate: dayInWeek('2026-06-03') },
      ];
      // cycles пуст → issue.findMany не должен вызываться.
      const { service, prisma } = buildService({ commitments, persons, plannedTasks, cycles: [] });
      const dto = await service.compute(
        { tenantId: 't-1', weekStart: WEEK_START, limit: 100, offset: 0, sort: 'reliability' },
        NOW,
      );
      const p1 = dto.rows.find((r) => r.personId === 'P1')!;
      expect(p1.tasksPlanned).toBe(1); // только Task-план
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
      // пересечение окна: startDate <= weekEnd И endDate >= weekStart
      expect(cycleCall.where.startDate.lte).toBeInstanceOf(Date);
      expect(cycleCall.where.endDate.gte).toBeInstanceOf(Date);

      const issueCall = prisma.issue.findMany.mock.calls[0]![0];
      expect(issueCall.where.tenantId).toBe('t-42');
      expect(issueCall.where.deletedAt).toBeNull();
      expect(issueCall.where.archivedAt).toBeNull();
      expect(issueCall.where.cycleId).toEqual({ in: ['C1'] });
    });
  });

  // ─────────────── ТЗ редизайн Ф8.5 — drill-down getPersonWeekItems ─────────

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
            dueDate: dayInWeek('2026-06-02'), // прошлый срок → overdue
          },
        ],
        checkIns: [
          {
            plansJson: [{ text: 'Созвон с поставщиком' }],
            donesJson: [], // нет факта → planned
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
      expect(commitment.blockedBy).toBeNull(); // не проблемный

      const task = dto.items.find((i) => i.kind === 'task')!;
      expect(task.title).toBe('Закрыть тикет №42');
      expect(task.factStatus).toBe('overdue');
      // overdue → подтягивает ближайший блокер из чек-ина
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
            donesJson: [{ text: 'написать отчёт' }], // регистр игнорируем
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
        checkIns: [
          { plansJson: [], donesJson: [], blockersJson: [{ text: 'Болезнь' }] },
        ],
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
