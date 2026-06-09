/**
 * Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0) — детерминированный
 * резолвер периода. Чистая функция БЕЗ LLM: на вход символический период
 * (`PeriodExpr`) от extract-plan агента, на выход — пара UTC-инстантов
 * [dateFrom, dateTo], которые позже станут recall-safe фильтром по дате.
 *
 * Почему руками, а не dayjs/luxon/chrono: в проекте нет date-библиотеки
 * (см. ТЗ), а граничная математика недель/месяцев тривиальна на голом
 * `Date.UTC` + фиксированный offset таймзоны.
 *
 * ВАЖНО про таймзону. Здесь поддержан ОДИН часовой пояс — Europe/Moscow
 * (UTC+3, фиксированный, без перехода на летнее время с 2014). Любое другое
 * или пустое значение `orgTimezone` тоже трактуется как +3 (дефолт компании).
 * Это осознанное упрощение Tier 0: подавляющее большинство клиентов Коры —
 * в МСК. Полноценный per-Org таймзонный резолвер (через Intl) — задача
 * следующего этапа, если появятся клиенты в других поясах.
 *
 * Чистота: функция детерминирована, не вызывает `Date.now()` — «сегодня»
 * приходит параметром `todayIso` (ISO момента «сейчас» от вызывающей стороны).
 */

export type PeriodExpr =
  | 'this_week'
  | 'last_week'
  | 'yesterday'
  | 'today'
  | 'this_month'
  | 'last_month'
  | 'last_n_days'
  | 'none';

export interface ResolvedPeriod {
  dateFrom: Date | null;
  dateTo: Date | null;
}

/**
 * Часовой пояс компании по умолчанию, если `Org.timezone` не задан
 * (ДОПУЩЕНИЕ, задокументировано). Europe/Moscow = фиксированный UTC+3,
 * без перехода на летнее время с 2014 года.
 */
export const DEFAULT_ORG_TIMEZONE = 'Europe/Moscow';

/** Миллисекунд в сутках. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Фиксированный offset часового пояса в минутах относительно UTC.
 * Поддержан только Europe/Moscow (+180). Для любого иного/пустого значения —
 * тоже +180 (дефолт компании, см. шапку файла).
 */
function offsetMinutes(orgTimezone?: string | null): number {
  // Единственный поддержанный пояс. Расширять список здесь, когда появятся
  // клиенты в других фиксированных поясах (например Asia/Yekaterinburg = +300).
  switch (orgTimezone) {
    case 'Europe/Moscow':
      return 180;
    default:
      return 180; // дефолт = МСК
  }
}

/**
 * Локальная (по таймзоне компании) календарная дата момента `instantMs`.
 * Возвращает {year, month0, day} — month0 нумеруется с 0 (как в Date.UTC).
 * Приём: сдвигаем UTC-инстант на offset вперёд и читаем UTC-компоненты —
 * получаем «настенные» год/месяц/день в поясе компании.
 */
function localCalendar(
  instantMs: number,
  offMin: number,
): { year: number; month0: number; day: number } {
  const shifted = new Date(instantMs + offMin * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month0: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/**
 * UTC-инстант локальной полуночи (00:00:00.000 по таймзоне компании) для
 * заданной локальной даты. Local-00:00 → UTC = subtract offset.
 */
function localMidnightUtc(
  year: number,
  month0: number,
  day: number,
  offMin: number,
): number {
  return Date.UTC(year, month0, day, 0, 0, 0, 0) - offMin * 60_000;
}

/**
 * Конец локального дня (23:59:59.999 по таймзоне компании) для даты, у которой
 * локальная полночь = `startUtcMs`. = старт + 1 сутки − 1 мс.
 */
function endOfLocalDay(startUtcMs: number): number {
  return startUtcMs + MS_PER_DAY - 1;
}

/**
 * День недели (0=Пн … 6=Вс) для локальной даты. JS `getUTCDay`: 0=Вс…6=Сб,
 * переводим в понедельник-первый.
 */
function localWeekday(
  year: number,
  month0: number,
  day: number,
): number {
  const jsDow = new Date(Date.UTC(year, month0, day)).getUTCDay(); // 0=Вс
  return (jsDow + 6) % 7; // 0=Пн … 6=Вс
}

export function resolvePeriod(
  expr: PeriodExpr,
  todayIso: string,
  orgTimezone?: string | null,
  periodDays?: number | null,
): ResolvedPeriod {
  const nowMs = Date.parse(todayIso);
  if (Number.isNaN(nowMs)) {
    return { dateFrom: null, dateTo: null };
  }
  const offMin = offsetMinutes(orgTimezone);
  const today = localCalendar(nowMs, offMin);
  // UTC-инстант локальной полуночи «сегодня».
  const todayMidnight = localMidnightUtc(
    today.year,
    today.month0,
    today.day,
    offMin,
  );

  switch (expr) {
    case 'today': {
      const from = todayMidnight;
      return { dateFrom: new Date(from), dateTo: new Date(endOfLocalDay(from)) };
    }
    case 'yesterday': {
      const from = todayMidnight - MS_PER_DAY;
      return { dateFrom: new Date(from), dateTo: new Date(endOfLocalDay(from)) };
    }
    case 'this_week': {
      const dow = localWeekday(today.year, today.month0, today.day); // 0=Пн
      const monStart = todayMidnight - dow * MS_PER_DAY;
      const sunEnd = endOfLocalDay(monStart + 6 * MS_PER_DAY);
      return { dateFrom: new Date(monStart), dateTo: new Date(sunEnd) };
    }
    case 'last_week': {
      const dow = localWeekday(today.year, today.month0, today.day); // 0=Пн
      const thisMonStart = todayMidnight - dow * MS_PER_DAY;
      const lastMonStart = thisMonStart - 7 * MS_PER_DAY;
      const lastSunEnd = endOfLocalDay(lastMonStart + 6 * MS_PER_DAY);
      return { dateFrom: new Date(lastMonStart), dateTo: new Date(lastSunEnd) };
    }
    case 'this_month': {
      const from = localMidnightUtc(today.year, today.month0, 1, offMin);
      // Полночь 1-го числа СЛЕДУЮЩЕГО месяца − 1 мс = конец последнего дня.
      const nextMonth = localMidnightUtc(
        today.year,
        today.month0 + 1,
        1,
        offMin,
      );
      return { dateFrom: new Date(from), dateTo: new Date(nextMonth - 1) };
    }
    case 'last_month': {
      const from = localMidnightUtc(today.year, today.month0 - 1, 1, offMin);
      // Конец прошлого месяца = полночь 1-го текущего − 1 мс.
      const thisMonthStart = localMidnightUtc(
        today.year,
        today.month0,
        1,
        offMin,
      );
      return { dateFrom: new Date(from), dateTo: new Date(thisMonthStart - 1) };
    }
    case 'last_n_days': {
      if (periodDays == null || periodDays <= 0) {
        return { dateFrom: null, dateTo: null };
      }
      const n = Math.floor(periodDays);
      // [today-(n-1) .. today] полные локальные дни.
      const from = todayMidnight - (n - 1) * MS_PER_DAY;
      const to = endOfLocalDay(todayMidnight);
      return { dateFrom: new Date(from), dateTo: new Date(to) };
    }
    case 'none':
    default:
      return { dateFrom: null, dateTo: null };
  }
}
