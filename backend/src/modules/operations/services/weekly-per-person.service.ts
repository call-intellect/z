import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  WeeklyPerPersonDto,
  WeeklyPersonRowDto,
} from '../dto/weekly-per-person.dto';

/**
 * ТЗ-D Фаза 4 (2026-06-05) — WeeklyPerPersonService.
 *
 * Read-only агрегат недельного план-факта по людям. Считает за неделю
 * [понедельник 00:00, воскресенье 23:59:59.999] по каждому человеку с
 * активностью:
 *   - обещания, ДАННЫЕ человеком (`IdeaBlock.commitmentAuthorPersonId`),
 *     раскладка по `commitmentStatus`;
 *   - закрытые задачи (`Task.status='done'`, `Task.assigneeUserId` ↔
 *     `Person.userId`, момент закрытия — `Task.updatedAt` в окне недели;
 *     отдельного поля «дата закрытия» в схеме нет);
 *   - завершённые чек-ины (`DailyCheckIn.completedAt` в окне недели).
 *
 * Все выборки — батч-findMany + JS-раскладка (без N+1). Кэш — Redis с TTL
 * 5 минут (паттерн как у `CommitmentReliabilityService`). На ошибки Redis не
 * падает, считает live. БЕЗ финансовых полей.
 */

const CACHE_TTL_SECONDS = 5 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 5;

/** Минимальная проекция IdeaBlock-обещания для раскладки по автору. */
interface CommitmentRow {
  commitmentAuthorPersonId: string | null;
  commitmentStatus: string | null;
  commitmentDueDate: Date | null;
}

/** Аккумулятор по одному человеку (до сборки финальной строки). */
interface PersonAcc {
  personId: string;
  personName: string;
  departmentId: string | null;
  userId: string | null;
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  tasksDone: number;
  checkInsCompleted: number;
}

export interface WeeklyPerPersonArgs {
  tenantId: string;
  /** Понедельник недели, YYYY-MM-DD. */
  weekStart: string;
  limit: number;
  offset: number;
  sort: 'reliability' | 'risk';
}

@Injectable()
export class WeeklyPerPersonService {
  private readonly logger = new Logger(WeeklyPerPersonService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Чистая реализация (без `new Date()` внутри): принимает фиксированный `now`
   * для детерминированных тестов (overdue считается относительно `now`).
   */
  async compute(
    args: WeeklyPerPersonArgs,
    now: Date,
  ): Promise<WeeklyPerPersonDto> {
    const { tenantId, weekStart, limit, offset, sort } = args;

    // 1. Границы недели: понедельник 00:00 → воскресенье 23:59:59.999 (UTC,
    //    чтобы не зависеть от локали машины).
    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * DAY_MS);
    weekEndDate.setUTCHours(23, 59, 59, 999);
    const weekEndStr = this.formatDate(weekEndDate);

    // 2. Кэш.
    const cacheKey = `weekly_per_person:${tenantId}:${weekStart}:${sort}:${limit}:${offset}`;
    const cached = await this.tryReadCache(cacheKey);
    if (cached) {
      return cached;
    }

    const dto = await this.computeFromDb(
      tenantId,
      weekStart,
      weekStartDate,
      weekEndDate,
      weekEndStr,
      limit,
      offset,
      sort,
      now,
    );

    await this.tryWriteCache(cacheKey, dto);
    return dto;
  }

  // ---------------------------------------------------------------------------
  // Внутреннее
  // ---------------------------------------------------------------------------

  private async computeFromDb(
    tenantId: string,
    weekStart: string,
    weekStartDate: Date,
    weekEndDate: Date,
    weekEndStr: string,
    limit: number,
    offset: number,
    sort: 'reliability' | 'risk',
    now: Date,
  ): Promise<WeeklyPerPersonDto> {
    // 3. Обещания по автору — одна выборка за неделю.
    const commitmentRows = (await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'commitment',
        commitmentAuthorPersonId: { not: null },
        commitmentDueDate: { gte: weekStartDate, lte: weekEndDate },
      },
      select: {
        commitmentAuthorPersonId: true,
        commitmentStatus: true,
        commitmentDueDate: true,
      },
    })) as CommitmentRow[];

    const accByPerson = new Map<string, PersonAcc>();
    const nowMs = now.getTime();

    for (const row of commitmentRows) {
      const personId = row.commitmentAuthorPersonId;
      if (!personId) continue;
      const acc = this.ensureAcc(accByPerson, personId);
      acc.promisesGiven += 1;
      const status = row.commitmentStatus;
      if (status === 'fulfilled') {
        acc.promisesKept += 1;
      } else if (status === 'missed') {
        acc.promisesBroken += 1;
      } else if (status === 'open' || status === 'asked') {
        const dueMs = row.commitmentDueDate?.getTime();
        if (dueMs !== undefined && dueMs < nowMs) {
          acc.promisesOverdue += 1;
        }
        // активные, ещё не наступившие — в reliability не идут (как в
        // CommitmentReliabilityService pendingActive).
      }
      // cancelled / superseded / null — игнорируем.
    }

    // Множество людей-авторов (обещаний). К ним добавим людей, у которых были
    // только задачи или чек-ины (см. ниже).
    const authorPersonIds = [...accByPerson.keys()];

    // 5a. Подтягиваем имена/отдел/userId людей-авторов.
    if (authorPersonIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, id: { in: authorPersonIds } },
        select: { id: true, name: true, userId: true, primaryDepartmentId: true },
      });
      for (const p of persons) {
        const acc = accByPerson.get(p.id);
        if (!acc) continue;
        acc.personName = p.name;
        acc.userId = p.userId ?? null;
        acc.departmentId = p.primaryDepartmentId ?? null;
      }
    }

    // 5b. Закрытые задачи: status='done', updatedAt в окне недели,
    //     assigneeUserId среди userId-ов авторов (не null).
    const userIdToPersonId = new Map<string, string>();
    for (const acc of accByPerson.values()) {
      if (acc.userId) userIdToPersonId.set(acc.userId, acc.personId);
    }
    const authorUserIds = [...userIdToPersonId.keys()];
    if (authorUserIds.length > 0) {
      const doneTasks = await this.prisma.task.findMany({
        where: {
          tenantId,
          status: 'done',
          assigneeUserId: { in: authorUserIds },
          updatedAt: { gte: weekStartDate, lte: weekEndDate },
        },
        select: { assigneeUserId: true },
      });
      for (const t of doneTasks) {
        if (!t.assigneeUserId) continue;
        const personId = userIdToPersonId.get(t.assigneeUserId);
        if (!personId) continue;
        const acc = accByPerson.get(personId);
        if (acc) acc.tasksDone += 1;
      }
    }

    // 6. Чек-ины: completedAt в окне недели. DailyCheckIn.tenantId — NOT NULL,
    //    фильтруем по нему.
    if (authorPersonIds.length > 0) {
      const checkIns = await this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId,
          personId: { in: authorPersonIds },
          completedAt: { not: null, gte: weekStartDate, lte: weekEndDate },
        },
        select: { personId: true },
      });
      for (const c of checkIns) {
        const acc = accByPerson.get(c.personId);
        if (acc) acc.checkInsCompleted += 1;
      }
    }

    // 7. Имена отделов — одной выборкой.
    const deptNameById = new Map<string, string>();
    const departmentIds = [
      ...new Set(
        [...accByPerson.values()]
          .map((a) => a.departmentId)
          .filter((d): d is string => d !== null),
      ),
    ];
    if (departmentIds.length > 0) {
      const departments = await this.prisma.department.findMany({
        where: { tenantId, id: { in: departmentIds } },
        select: { id: true, name: true },
      });
      for (const d of departments) deptNameById.set(d.id, d.name);
    }

    // 8. Полное множество строк (все люди с активностью за неделю — у всех в
    //    accByPerson есть ≥1 обещание; задачи/чек-ины привязаны только к ним).
    const allRows: WeeklyPersonRowDto[] = [...accByPerson.values()].map((acc) =>
      this.buildRow(acc, deptNameById),
    );
    const total = allRows.length;

    // 9. topReliable / topRisk — от ПОЛНОГО множества.
    const topReliable = this.sortByReliability([...allRows]).slice(0, TOP_N);
    const topRisk = this.sortByRisk([...allRows]).slice(0, TOP_N);

    // 10. rows — полное множество по `sort`, затем пагинация.
    const sorted =
      sort === 'risk'
        ? this.sortByRisk([...allRows])
        : this.sortByReliability([...allRows]);
    const rows = sorted.slice(offset, offset + limit);

    // 11. Сборка DTO.
    return {
      weekStart,
      weekEnd: weekEndStr,
      generatedAt: now.toISOString(),
      total,
      topReliable,
      topRisk,
      rows,
    };
  }

  private ensureAcc(map: Map<string, PersonAcc>, personId: string): PersonAcc {
    let acc = map.get(personId);
    if (!acc) {
      acc = {
        personId,
        personName: '',
        departmentId: null,
        userId: null,
        promisesGiven: 0,
        promisesKept: 0,
        promisesBroken: 0,
        promisesOverdue: 0,
        tasksDone: 0,
        checkInsCompleted: 0,
      };
      map.set(personId, acc);
    }
    return acc;
  }

  private buildRow(
    acc: PersonAcc,
    deptNameById: Map<string, string>,
  ): WeeklyPersonRowDto {
    return {
      personId: acc.personId,
      personName: acc.personName,
      departmentName:
        acc.departmentId !== null
          ? (deptNameById.get(acc.departmentId) ?? null)
          : null,
      promisesGiven: acc.promisesGiven,
      promisesKept: acc.promisesKept,
      promisesBroken: acc.promisesBroken,
      promisesOverdue: acc.promisesOverdue,
      reliabilityPercent: this.calcReliability(acc),
      tasksDone: acc.tasksDone,
      checkInsCompleted: acc.checkInsCompleted,
    };
  }

  /**
   * kept / max(1, kept+broken+overdue) * 100, округление до целого.
   * R8: если знаменатель=0 → null (не делим на ноль, не возвращаем 0).
   */
  private calcReliability(acc: PersonAcc): number | null {
    const denom = acc.promisesKept + acc.promisesBroken + acc.promisesOverdue;
    if (denom === 0) return null;
    return Math.round((acc.promisesKept / Math.max(1, denom)) * 100);
  }

  /**
   * Сортировка по надёжности desc. null трактуем как самый низкий
   * (ниже любого числа). При равенстве reliabilityPercent — promisesKept desc.
   */
  private sortByReliability(rows: WeeklyPersonRowDto[]): WeeklyPersonRowDto[] {
    return rows.sort((a, b) => {
      const ra = a.reliabilityPercent;
      const rb = b.reliabilityPercent;
      if (ra !== rb) {
        if (ra === null) return 1;
        if (rb === null) return -1;
        return rb - ra;
      }
      return b.promisesKept - a.promisesKept;
    });
  }

  /**
   * Сортировка по риску desc — (broken + overdue) убыванием. При равенстве —
   * reliabilityPercent asc (null как самый низкий → выше в риске).
   */
  private sortByRisk(rows: WeeklyPersonRowDto[]): WeeklyPersonRowDto[] {
    return rows.sort((a, b) => {
      const riskA = a.promisesBroken + a.promisesOverdue;
      const riskB = b.promisesBroken + b.promisesOverdue;
      if (riskA !== riskB) return riskB - riskA;
      // tie-break: reliabilityPercent asc (хуже надёжность → выше в риске).
      const ra = a.reliabilityPercent;
      const rb = b.reliabilityPercent;
      if (ra === rb) return 0;
      if (ra === null) return -1;
      if (rb === null) return 1;
      return ra - rb;
    });
  }

  private formatDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // ---------------------------------------------------------------------------
  // Redis-кэш (паттерн как у CommitmentReliabilityService)
  // ---------------------------------------------------------------------------

  private async tryReadCache(key: string): Promise<WeeklyPerPersonDto | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as WeeklyPerPersonDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async tryWriteCache(
    key: string,
    dto: WeeklyPerPersonDto,
  ): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(dto),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
