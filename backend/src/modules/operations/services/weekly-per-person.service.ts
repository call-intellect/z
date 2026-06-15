import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { reliabilityOrLowData } from '../../dashboard/services/commitment-reliability.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type {
  WeeklyPerPersonDto,
  WeeklyPersonItemDto,
  WeeklyPersonItemFactStatus,
  WeeklyPersonItemsDto,
  WeeklyPersonRowDto,
} from '../dto/weekly-per-person.dto';
import { completeCommitmentWhere } from '../utils/commitment-completeness';

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
/** Code-fallback для `reliability.min_denominator` (см. AdminSetting). */
const DEFAULT_MIN_DENOMINATOR = 3;

/** Минимальная проекция IdeaBlock-обещания для раскладки по автору. */
interface CommitmentRow {
  id: string;
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
  /** ТЗ-2 Ф4 — обещания «без ответа» (commitmentStatus='asked'). */
  promisesNoAnswer: number;
  tasksDone: number;
  /**
   * ТЗ редизайн Ф8.5 (🟡) — задачи, ЗАПЛАНИРОВАННЫЕ на неделю (Task.dueDate в
   * окне недели, назначенные человеку). В отличие от tasksDone (по updatedAt
   * закрытия) — по сроку.
   */
  tasksPlanned: number;
  /** Сколько из запланированных на неделю задач закрыты (status='done'). */
  tasksPlannedDone: number;
  /**
   * A11.1 (2026-06-14) — issueId задач трекера в активном цикле недели, уже
   * учтённых за этого человека в tasksPlanned. Дедуп-гард: один `Issue`,
   * назначенный на нескольких исполнителей, считается у каждого ровно один раз
   * (на случай повторной/расширенной выборки — счёт идемпотентен).
   */
  countedCycleIssueIds: Set<string>;
  checkInsCompleted: number;
  /**
   * ТЗ-2 Ф4 — множество blockId обещаний, УЖЕ учтённых за этого человека.
   * Используется как dedup-гард: закрытая задача, порождённая одним из этих
   * блоков (`Task.evidenceBlockIds` ⊇ blockId), НЕ инкрементит tasksDone —
   * иначе «обещание, ставшее задачей» раздувает delivery.
   */
  countedCommitmentBlockIds: Set<string>;
}

export interface WeeklyPerPersonArgs {
  tenantId: string;
  /** Понедельник недели, YYYY-MM-DD. */
  weekStart: string;
  limit: number;
  offset: number;
  sort: 'reliability' | 'risk';
}

/** ТЗ редизайн Ф8.5 — аргументы drill-down «план-факт по людям». */
export interface WeeklyPersonWeekItemsArgs {
  tenantId: string;
  personId: string;
  /** Понедельник недели, YYYY-MM-DD. */
  weekStart: string;
}

/** Минимальная проекция чек-ина для drill-down (plans/dones/blockers). */
interface CheckInRow {
  plansJson: unknown;
  donesJson: unknown;
  blockersJson: unknown;
}

/** Элемент plansJson / donesJson (поле text — то, что показываем). */
interface CheckInTextItem {
  text?: unknown;
}

@Injectable()
export class WeeklyPerPersonService {
  private readonly logger = new Logger(WeeklyPerPersonService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
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

    // ТЗ-2 Ф4 — минимальный знаменатель reliability читаем ОДИН раз на compute()
    // (не per-row), передаём вниз в расчёт. Ниже него reliabilityPercent=null.
    const minDenom = await this.cfg.getDynamic<number>(
      'reliability.min_denominator',
      'RELIABILITY_MIN_DENOMINATOR',
      DEFAULT_MIN_DENOMINATOR,
    );

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
      minDenom,
    );

    await this.tryWriteCache(cacheKey, dto);
    return dto;
  }

  // ---------------------------------------------------------------------------
  // ТЗ редизайн Ф8.5 — drill-down «план-факт по людям» (построчный список).
  // ---------------------------------------------------------------------------

  /**
   * Построчный план-факт по одному человеку за неделю из ВСЕХ трёх источников:
   *   - commitment: IdeaBlock signalType='commitment', автор=personId, срок в
   *     неделю (полные обещания — completeCommitmentWhere);
   *   - task: Task назначенные человеку с dueDate в неделю (план = срок);
   *   - checkin: каждый план из plansJson чек-инов недели как пункт; факт —
   *     наличие в donesJson; «что мешало» — ближайший блокер из blockersJson.
   *
   * `blockedBy` для overdue/missed-пунктов — ближайший (по индексу) блокер из
   * blockersJson за неделю. Атрибуция блокеров графа (signalType='blocker')
   * к человеку детерминированно невозможна (нет authorPersonId-аналога), поэтому
   * НЕ используется — источник «что мешало» это чек-ины человека.
   *
   * Live (без кэша): drill-down вызывается реже агрегата и должен быть свежим.
   */
  async getPersonWeekItems(
    args: WeeklyPersonWeekItemsArgs,
    now: Date,
  ): Promise<WeeklyPersonItemsDto> {
    const { tenantId, personId, weekStart } = args;

    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * DAY_MS);
    weekEndDate.setUTCHours(23, 59, 59, 999);
    const weekEndStr = this.formatDate(weekEndDate);
    const nowMs = now.getTime();

    // Person.userId нужен для связи с Task.assigneeUserId.
    const person = await this.prisma.person.findFirst({
      where: { tenantId, id: personId },
      select: { userId: true },
    });

    const [commitmentRows, taskRows, checkInRows] = await Promise.all([
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId,
          signalType: 'commitment',
          commitmentAuthorPersonId: personId,
          commitmentDueDate: { gte: weekStartDate, lte: weekEndDate },
          ...completeCommitmentWhere(),
        },
        select: { name: true, commitmentStatus: true, commitmentDueDate: true },
      }),
      person?.userId
        ? this.prisma.task.findMany({
            where: {
              tenantId,
              assigneeUserId: person.userId,
              dueDate: { gte: weekStartDate, lte: weekEndDate },
            },
            select: { title: true, status: true, dueDate: true },
          })
        : Promise.resolve(
            [] as Array<{
              title: string;
              status: string;
              dueDate: Date | null;
            }>,
          ),
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId,
          personId,
          completedAt: { not: null, gte: weekStartDate, lte: weekEndDate },
        },
        select: { plansJson: true, donesJson: true, blockersJson: true },
      }) as Promise<CheckInRow[]>,
    ]);

    // Блокеры за неделю (плоский список текстов) — для blockedBy у overdue/missed.
    const weekBlockers = this.collectBlockerTexts(checkInRows);
    const nearestBlocker = weekBlockers.length > 0 ? weekBlockers[0]! : null;

    const items: WeeklyPersonItemDto[] = [];

    // commitment-пункты.
    for (const c of commitmentRows) {
      const dueMs = c.commitmentDueDate?.getTime();
      const factStatus = this.commitmentFactStatus(
        c.commitmentStatus,
        dueMs,
        nowMs,
      );
      items.push({
        kind: 'commitment',
        title: c.name,
        plannedDue: c.commitmentDueDate
          ? c.commitmentDueDate.toISOString()
          : null,
        factStatus,
        blockedBy:
          factStatus === 'overdue' || factStatus === 'missed'
            ? nearestBlocker
            : null,
      });
    }

    // task-пункты.
    for (const t of taskRows) {
      const dueMs = t.dueDate?.getTime();
      const factStatus = this.taskFactStatus(t.status, dueMs, nowMs);
      items.push({
        kind: 'task',
        title: t.title,
        plannedDue: t.dueDate ? t.dueDate.toISOString() : null,
        factStatus,
        blockedBy: factStatus === 'overdue' ? nearestBlocker : null,
      });
    }

    // checkin-пункты: каждый план как item; done если текст есть в donesJson.
    const doneTexts = new Set<string>();
    for (const row of checkInRows) {
      for (const text of this.extractTexts(row.donesJson)) {
        doneTexts.add(this.normalizeText(text));
      }
    }
    for (const row of checkInRows) {
      for (const text of this.extractTexts(row.plansJson)) {
        const done = doneTexts.has(this.normalizeText(text));
        items.push({
          kind: 'checkin',
          title: text,
          plannedDue: null,
          factStatus: done ? 'done' : 'planned',
          blockedBy: done ? null : nearestBlocker,
        });
      }
    }

    return { personId, weekStart, weekEnd: weekEndStr, items };
  }

  /** Маппинг commitmentStatus → factStatus пункта (см. контракт DTO). */
  private commitmentFactStatus(
    status: string | null,
    dueMs: number | undefined,
    nowMs: number,
  ): WeeklyPersonItemFactStatus {
    if (status === 'fulfilled') return 'fulfilled';
    if (status === 'missed') return 'missed';
    // open / asked / null: просрочен если срок прошёл; иначе asked → 'asked',
    // прочее → 'open'.
    if (dueMs !== undefined && dueMs < nowMs) return 'overdue';
    if (status === 'asked') return 'asked';
    return 'open';
  }

  /** Маппинг Task.status + срок → factStatus пункта. */
  private taskFactStatus(
    status: string,
    dueMs: number | undefined,
    nowMs: number,
  ): WeeklyPersonItemFactStatus {
    if (status === 'done') return 'done';
    if (dueMs !== undefined && dueMs < nowMs) return 'overdue';
    return 'open';
  }

  /** Тексты из plansJson/donesJson (Array<{ text }>) с фильтром пустых. */
  private extractTexts(json: unknown): string[] {
    if (!Array.isArray(json)) return [];
    const out: string[] = [];
    for (const item of json as CheckInTextItem[]) {
      const text = item?.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        out.push(text.trim());
      }
    }
    return out;
  }

  /** Плоский список текстов блокеров за неделю (порядок чек-инов сохраняем). */
  private collectBlockerTexts(rows: CheckInRow[]): string[] {
    const out: string[] = [];
    for (const row of rows) {
      out.push(...this.extractTexts(row.blockersJson));
    }
    return out;
  }

  private normalizeText(s: string): string {
    return s.trim().toLowerCase();
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
    minDenom: number,
  ): Promise<WeeklyPerPersonDto> {
    // 3. Обещания по автору — одна выборка за неделю. `id` нужен для dedup-гарда
    //    задач (см. ниже): закрытая задача, порождённая учтённым блоком-обещанием,
    //    не должна повторно считаться в tasksDone.
    const commitmentRows = (await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'commitment',
        // ТЗ редизайн Ф7б (Б-3) — полный предикат полноты вместо частичного
        // гейта только по автору: учитываем лишь полные обещания (автор + либо
        // адресат, либо срок). Неполные — «открытые вопросы», в план-факт не идут.
        commitmentDueDate: { gte: weekStartDate, lte: weekEndDate },
        ...completeCommitmentWhere(),
      },
      select: {
        id: true,
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
      acc.countedCommitmentBlockIds.add(row.id);
      const status = row.commitmentStatus;
      if (status === 'fulfilled') {
        acc.promisesKept += 1;
      } else if (status === 'missed') {
        acc.promisesBroken += 1;
      } else if (status === 'open' || status === 'asked') {
        if (status === 'asked') {
          // ТЗ-2 Ф4 — «без ответа»: probe ушёл, человек не подтвердил/не
          // отверг. Считаем В ДОПОЛНЕНИЕ к overdue-логике ниже.
          acc.promisesNoAnswer += 1;
        }
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
        // ТЗ-2 Ф4 — evidenceBlockIds: какие IdeaBlock'и породили задачу. Нужны
        // для dedup-гарда против двойного счёта «обещание → задача».
        select: { assigneeUserId: true, evidenceBlockIds: true },
      });
      // dedup-множество уже зачтённых taskId — этот же таск не считаем дважды
      // (findMany не вернёт дубль, но гард делает счётчик заведомо защищённым).
      for (const t of doneTasks) {
        if (!t.assigneeUserId) continue;
        const personId = userIdToPersonId.get(t.assigneeUserId);
        if (!personId) continue;
        const acc = accByPerson.get(personId);
        if (!acc) continue;
        // Если задача порождена одним из УЖЕ учтённых блоков-обещаний этого
        // человека — это «обещание, ставшее задачей»: пропускаем, чтобы не
        // раздувать delivery двойным счётом одного артефакта.
        if (this.taskFromCountedCommitment(t.evidenceBlockIds, acc)) continue;
        acc.tasksDone += 1;
      }

      // 5c. ТЗ редизайн Ф8.5 (🟡) — ЗАПЛАНИРОВАННЫЕ на неделю задачи: dueDate в
      //     окне недели (не updatedAt). Отдельная выборка — «план» по сроку, а
      //     не «факт» по закрытию. tasksNotDone = planned − doneAmongPlanned.
      const plannedTasks = await this.prisma.task.findMany({
        where: {
          tenantId,
          assigneeUserId: { in: authorUserIds },
          dueDate: { gte: weekStartDate, lte: weekEndDate },
        },
        select: { assigneeUserId: true, status: true },
      });
      for (const t of plannedTasks) {
        if (!t.assigneeUserId) continue;
        const personId = userIdToPersonId.get(t.assigneeUserId);
        if (!personId) continue;
        const acc = accByPerson.get(personId);
        if (!acc) continue;
        acc.tasksPlanned += 1;
        if (t.status === 'done') acc.tasksPlannedDone += 1;
      }

      // 5d. A11.1 (2026-06-14) — задачи трекера (`Issue`) в АКТИВНОМ цикле недели
      //     тоже считаются «запланированными на неделю», даже если у самой задачи
      //     dueDate вне окна (план задаёт цикл, а не личный срок). Аддитивно к
      //     Task-плану (это разные таблицы — двойного счёта между ними нет).
      //
      //     ⚠️ Модель: у `Issue` НЕТ `assigneeUserId` (он есть только у legacy
      //     `Task`); исполнители — M:M через `IssueAssignee` (`assignees.some.userId`).
      //     Завершённость задачи трекера — `Issue.completedAt != null` (канон,
      //     см. decision-implementation.service.ts / IssueOverdueDetectorCron),
      //     отдельного `status='done'` у `Issue` нет.
      await this.addCycleIssuesToPlan(
        tenantId,
        weekStartDate,
        weekEndDate,
        authorUserIds,
        userIdToPersonId,
        accByPerson,
      );
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
      this.buildRow(acc, deptNameById, minDenom),
    );
    const total = allRows.length;

    // ТЗ-2 Ф4 — метрики: суммарные «без ответа» за compute + факт отдачи
    // (per-tenant top-100 bucket, cardinality-safe).
    const noAnswerTotal = allRows.reduce(
      (sum, r) => sum + r.promisesNoAnswer,
      0,
    );
    this.metrics.recordWeeklyPerPersonCompute({
      tenantTop: tenantTopOf(tenantId),
      noAnswerTotal,
    });

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
        promisesNoAnswer: 0,
        tasksDone: 0,
        tasksPlanned: 0,
        tasksPlannedDone: 0,
        countedCycleIssueIds: new Set<string>(),
        checkInsCompleted: 0,
        countedCommitmentBlockIds: new Set<string>(),
      };
      map.set(personId, acc);
    }
    return acc;
  }

  /**
   * ТЗ-2 Ф4 — dedup-гард: возвращает true, если закрытая задача порождена
   * хотя бы одним блоком-обещанием, уже учтённым за этого человека
   * (`Task.evidenceBlockIds` ∩ `acc.countedCommitmentBlockIds` ≠ ∅).
   */
  private taskFromCountedCommitment(
    evidenceBlockIds: string[] | null | undefined,
    acc: PersonAcc,
  ): boolean {
    if (!Array.isArray(evidenceBlockIds) || evidenceBlockIds.length === 0) {
      return false;
    }
    for (const blockId of evidenceBlockIds) {
      if (acc.countedCommitmentBlockIds.has(blockId)) return true;
    }
    return false;
  }

  /**
   * A11.1 (2026-06-14) — подмешивает в PLAN задачи трекера (`Issue`) из АКТИВНЫХ
   * циклов недели, назначенные людям-авторам, увеличивая `tasksPlanned`
   * (и `tasksPlannedDone`, если задача завершена — `Issue.completedAt != null`).
   *
   * «Активный цикл недели» — `Cycle` с `completedAt = null`, чьё окно
   * `[startDate..endDate]` пересекается с окном недели (`startDate <= weekEnd`
   * И `endDate >= weekStart`). Tenant-скоуп на обеих выборках. Если активных
   * циклов нет — выходит без второй выборки.
   *
   * Дедуп: `acc.countedCycleIssueIds` гарантирует, что один `Issue`,
   * назначенный человеку, считается за него ровно один раз. Аддитивно к
   * Task-плану (`Task` и `Issue` — разные таблицы, пересечения нет).
   */
  private async addCycleIssuesToPlan(
    tenantId: string,
    weekStartDate: Date,
    weekEndDate: Date,
    authorUserIds: string[],
    userIdToPersonId: Map<string, string>,
    accByPerson: Map<string, PersonAcc>,
  ): Promise<void> {
    if (authorUserIds.length === 0) return;

    // 1. Активные циклы недели (tenant-скоуп, не завершённые, окно пересекает).
    const activeCycles = await this.prisma.cycle.findMany({
      where: {
        tenantId,
        completedAt: null,
        startDate: { lte: weekEndDate },
        endDate: { gte: weekStartDate },
      },
      select: { id: true },
    });
    if (activeCycles.length === 0) return;
    const cycleIds = activeCycles.map((c) => c.id);

    // 2. Задачи трекера в этих циклах, назначенные людям-авторам, живые
    //    (не soft-deleted / не архив). Исполнители — M:M через IssueAssignee.
    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId,
        cycleId: { in: cycleIds },
        deletedAt: null,
        archivedAt: null,
        assignees: { some: { userId: { in: authorUserIds } } },
      },
      select: {
        id: true,
        completedAt: true,
        assignees: { select: { userId: true } },
      },
    });

    // 3. Раскладка по людям. Один Issue может быть назначен нескольким — каждому
    //    идёт в план по разу (дедуп через countedCycleIssueIds на acc).
    const authorUserIdSet = new Set(authorUserIds);
    for (const issue of issues) {
      const isDone = issue.completedAt !== null;
      for (const a of issue.assignees) {
        if (!authorUserIdSet.has(a.userId)) continue;
        const personId = userIdToPersonId.get(a.userId);
        if (!personId) continue;
        const acc = accByPerson.get(personId);
        if (!acc) continue;
        if (acc.countedCycleIssueIds.has(issue.id)) continue;
        acc.countedCycleIssueIds.add(issue.id);
        acc.tasksPlanned += 1;
        if (isDone) acc.tasksPlannedDone += 1;
      }
    }
  }

  private buildRow(
    acc: PersonAcc,
    deptNameById: Map<string, string>,
    minDenom: number,
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
      promisesNoAnswer: acc.promisesNoAnswer,
      reliabilityPercent: this.calcReliability(acc, minDenom),
      tasksDone: acc.tasksDone,
      tasksPlanned: acc.tasksPlanned,
      tasksNotDone: Math.max(0, acc.tasksPlanned - acc.tasksPlannedDone),
      checkInsCompleted: acc.checkInsCompleted,
    };
  }

  /**
   * kept / (kept+broken+overdue) * 100, округление до целого.
   * ТЗ-2 Ф4: переиспользуем `reliabilityOrLowData` — null, если знаменатель=0
   * ИЛИ меньше `minDenom` («мало данных»: 1/1=100% при крошечном знаменателе
   * вводит в заблуждение). Раньше null был только при знаменателе=0.
   */
  private calcReliability(acc: PersonAcc, minDenom: number): number | null {
    const denom = acc.promisesKept + acc.promisesBroken + acc.promisesOverdue;
    return reliabilityOrLowData(acc.promisesKept, denom, minDenom);
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
