import { z } from 'zod';

/**
 * ТЗ-D Фаза 4 (2026-06-05) — DTO недельного план-факта по людям.
 *
 * Эндпоинт `GET /api/v1/dashboard/operations/weekly-per-person?weekStart=YYYY-MM-DD`.
 * Агрегирует за неделю [понедельник, воскресенье] по каждому человеку:
 *   - обещания, ДАННЫЕ человеком (по `IdeaBlock.commitmentAuthorPersonId`);
 *   - закрытые задачи (`Task.status='done'`, `Task.assigneeUserId` ↔ `Person.userId`);
 *   - завершённые чек-ины (`DailyCheckIn.completedAt` в неделю).
 *
 * БЕЗ финансов. Источник правды о полях — `backend/prisma/schema.prisma`.
 */

/**
 * Query-схема. `weekStart` — понедельник недели (YYYY-MM-DD).
 * `invalid_week_start` — message regex (попадает в issues пайпа).
 */
export const WeeklyPerPersonQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
  limit: z.coerce.number().int().min(1).max(100).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['reliability', 'risk']).default('reliability'),
});
export type WeeklyPerPersonQuery = z.infer<typeof WeeklyPerPersonQuerySchema>;

/** Строка план-факта по одному человеку за неделю. */
export interface WeeklyPersonRowDto {
  personId: string;
  personName: string;
  departmentName: string | null;
  /** Обещания, ДАННЫЕ человеком (по commitmentAuthorPersonId). */
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  /**
   * ТЗ-2 Ф4 — обещания «без ответа»: `commitmentStatus='asked'` (probe ушёл,
   * человек не подтвердил/не отверг). Подмножество данных за неделю; пересекается
   * с promisesOverdue (если срок 'asked'-обещания уже прошёл, оно и тут, и там).
   */
  promisesNoAnswer: number;
  /**
   * kept / max(1, kept+broken+overdue) * 100; null если знаменатель < min_denominator
   * (ТЗ-2 Ф4 — «мало данных»: при крошечном знаменателе 1/1=100% врёт).
   */
  reliabilityPercent: number | null;
  /** Закрытые задачи (Task.assigneeUserId через Person.userId). */
  tasksDone: number;
  /**
   * ТЗ редизайн Ф8.5 (🟡) — задачи, ЗАПЛАНИРОВАННЫЕ на неделю: `Task` с
   * `dueDate` в окне недели, назначенные человеку (`assigneeUserId` ↔
   * `Person.userId`). В отличие от `tasksDone` (момент закрытия — `updatedAt`),
   * берёт срок, а не факт закрытия, поэтому числа могут не совпадать (задача со
   * сроком на эту неделю могла быть закрыта на прошлой и наоборот).
   */
  tasksPlanned: number;
  /**
   * ТЗ редизайн Ф8.5 (🟡) — задачи недели, ещё НЕ сделанные:
   * `max(0, tasksPlanned − doneAmongPlanned)`, где `doneAmongPlanned` — сколько
   * из запланированных на неделю задач закрыты (status='done'). Раньше было
   * видно только `tasksDone`; «сколько не сделано из плана» — не было.
   */
  tasksNotDone: number;
  /** Завершённые чек-ины (DailyCheckIn.completedAt в неделю). */
  checkInsCompleted: number;
}

export interface WeeklyPerPersonDto {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  total: number;
  topReliable: WeeklyPersonRowDto[];
  topRisk: WeeklyPersonRowDto[];
  rows: WeeklyPersonRowDto[];
}

/**
 * ТЗ-2 Ф4 — self-view недельного план-факта (`GET /api/v1/me/weekly-per-person`).
 *
 * Любой авторизованный пользователь с Person-записью видит ТОЛЬКО свою строку
 * (без RBAC operations-dashboard). `teamAverageReliabilityPercent` — среднее
 * `reliabilityPercent` по не-null строкам всей команды за неделю, чтобы фронт
 * нарисовал стрелку «я vs команда». null, если нет ни одной достоверной строки
 * или у пользователя нет Person.
 */
export interface MyWeeklyPerPersonDto {
  weekStart: string;
  weekEnd: string;
  row: WeeklyPersonRowDto | null;
  teamAverageReliabilityPercent: number | null;
}

// ----------------------------------------------------------------------------
// ТЗ редизайн Ф8.5 — drill-down «план-факт по людям» (построчный список).
// `GET /api/v1/dashboard/operations/weekly-per-person/:personId/items`
// `GET /api/v1/me/weekly-per-person/:personId/items`
// ----------------------------------------------------------------------------

/** Query-схема drill-down: только понедельник недели (YYYY-MM-DD). */
export const WeeklyPersonItemsQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
});
export type WeeklyPersonItemsQuery = z.infer<
  typeof WeeklyPersonItemsQuerySchema
>;

/** Источник пункта план-факта. */
export type WeeklyPersonItemKind = 'task' | 'commitment' | 'checkin';

/**
 * Статус факта по пункту (объединение по трём источникам):
 *   - task: 'done' | 'overdue' (срок прошёл и не закрыта) | 'open';
 *   - commitment: 'fulfilled' | 'missed' | 'asked' | 'overdue' (open/asked со
 *     срокoм < now) | 'open';
 *   - checkin: 'done' (план есть в donesJson) | 'planned' (план без факта).
 */
export type WeeklyPersonItemFactStatus =
  | 'done'
  | 'open'
  | 'overdue'
  | 'fulfilled'
  | 'missed'
  | 'asked'
  | 'planned';

/** Один пункт построчного план-факта по человеку за неделю. */
export interface WeeklyPersonItemDto {
  kind: WeeklyPersonItemKind;
  /** Текст пункта: title задачи / текст обещания / текст плана из чек-ина. */
  title: string;
  /** Плановый срок (ISO). null для checkin-пунктов (срок — день чек-ина). */
  plannedDue: string | null;
  factStatus: WeeklyPersonItemFactStatus;
  /**
   * «Что мешало»: для overdue/missed-пунктов — ближайший блокер за неделю из
   * `DailyCheckIn.blockersJson` человека. null если блокеров нет/пункт не
   * проблемный.
   */
  blockedBy: string | null;
}

/** Ответ drill-down: построчный план-факт по человеку за неделю. */
export interface WeeklyPersonItemsDto {
  personId: string;
  weekStart: string;
  weekEnd: string;
  items: WeeklyPersonItemDto[];
}
