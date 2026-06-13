import { z } from 'zod';

/**
 * ТЗ Ф8.7 (cabinet-redesign-rhythms) — DTO виджета «Дисциплина чек-инов».
 *
 * `GET /api/v1/dashboard/operations/checkin-discipline?from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * Считает сколько утренних/вечерних чек-инов было ожидаемо (placeholder создан
 * cron'ом при приглашении), сколько сдано (`completedAt != null`) и сколько
 * пропущено — суммарно и по людям. Источник — `DailyCheckIn`.
 *
 * `enabled=false` (флаг `DAILY_CHECKIN_ENABLED` выключен) → totals по нулям,
 * фронт показывает Б-6 «нет данных» с причиной «чек-ины выключены».
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Query `GET /dashboard/operations/checkin-discipline?from=&to=`. */
export const CheckinDisciplineQuerySchema = z
  .object({
    /** Начало окна (включительно), YYYY-MM-DD. Default — понедельник текущей недели. */
    from: z.string().regex(DATE_RE).optional(),
    /** Конец окна (включительно), YYYY-MM-DD. Default — сегодня (МСК). */
    to: z.string().regex(DATE_RE).optional(),
  })
  .strict();
export type CheckinDisciplineQuery = z.infer<typeof CheckinDisciplineQuerySchema>;

/** Сводка дисциплины (суммарно по периоду или по одному человеку). */
export interface CheckinDisciplineTotalsDto {
  morningExpected: number;
  morningCompleted: number;
  morningMissed: number;
  eveningExpected: number;
  eveningCompleted: number;
  eveningMissed: number;
  /**
   * (morningCompleted + eveningCompleted) / (morningExpected + eveningExpected),
   * диапазон 0..1. `null`, если ожидаемых чек-инов не было (деления на 0 нет).
   */
  completionRate: number | null;
}

/** Дисциплина по одному человеку. */
export interface CheckinDisciplinePersonDto extends CheckinDisciplineTotalsDto {
  personId: string;
  personName: string;
}

/** Ответ `GET /dashboard/operations/checkin-discipline`. */
export interface CheckinDisciplineDto {
  /** Начало окна (YYYY-MM-DD), как реально применено. */
  from: string;
  /** Конец окна (YYYY-MM-DD), как реально применено. */
  to: string;
  /** Флаг `DAILY_CHECKIN_ENABLED`. false → totals по нулям, причина «нет данных». */
  enabled: boolean;
  totals: CheckinDisciplineTotalsDto;
  byPerson: CheckinDisciplinePersonDto[];
}
