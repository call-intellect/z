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
