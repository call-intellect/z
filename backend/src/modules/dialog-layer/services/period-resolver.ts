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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'Europe/Moscow';
const DEFAULT_OFFSET_MIN = 180;

function tzOffsetMinutes(instantMs: number, timeZone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(instantMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    let hour = get('hour');
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      hour,
      get('minute'),
      get('second'),
    );
    if (Number.isNaN(asUtc)) return null;
    return Math.round((asUtc - instantMs) / 60_000);
  } catch {
    return null;
  }
}

function offsetMinutes(instantMs: number, orgTimezone?: string | null): number {
  const tz = orgTimezone && orgTimezone.length > 0 ? orgTimezone : DEFAULT_TIMEZONE;
  const off = tzOffsetMinutes(instantMs, tz);
  if (off == null) {
    return tzOffsetMinutes(instantMs, DEFAULT_TIMEZONE) ?? DEFAULT_OFFSET_MIN;
  }
  return off;
}

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

function localMidnightUtc(year: number, month0: number, day: number, offMin: number): number {
  return Date.UTC(year, month0, day, 0, 0, 0, 0) - offMin * 60_000;
}

function endOfLocalDay(startUtcMs: number): number {
  return startUtcMs + MS_PER_DAY - 1;
}

function localWeekday(year: number, month0: number, day: number): number {
  const jsDow = new Date(Date.UTC(year, month0, day)).getUTCDay();
  return (jsDow + 6) % 7;
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
  const offMin = offsetMinutes(nowMs, orgTimezone);
  const today = localCalendar(nowMs, offMin);
  const todayMidnight = localMidnightUtc(today.year, today.month0, today.day, offMin);

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
      const dow = localWeekday(today.year, today.month0, today.day);
      const monStart = todayMidnight - dow * MS_PER_DAY;
      const sunEnd = endOfLocalDay(monStart + 6 * MS_PER_DAY);
      return { dateFrom: new Date(monStart), dateTo: new Date(sunEnd) };
    }
    case 'last_week': {
      const dow = localWeekday(today.year, today.month0, today.day);
      const thisMonStart = todayMidnight - dow * MS_PER_DAY;
      const lastMonStart = thisMonStart - 7 * MS_PER_DAY;
      const lastSunEnd = endOfLocalDay(lastMonStart + 6 * MS_PER_DAY);
      return { dateFrom: new Date(lastMonStart), dateTo: new Date(lastSunEnd) };
    }
    case 'this_month': {
      const from = localMidnightUtc(today.year, today.month0, 1, offMin);
      const nextMonth = localMidnightUtc(today.year, today.month0 + 1, 1, offMin);
      return { dateFrom: new Date(from), dateTo: new Date(nextMonth - 1) };
    }
    case 'last_month': {
      const from = localMidnightUtc(today.year, today.month0 - 1, 1, offMin);
      const thisMonthStart = localMidnightUtc(today.year, today.month0, 1, offMin);
      return { dateFrom: new Date(from), dateTo: new Date(thisMonthStart - 1) };
    }
    case 'last_n_days': {
      if (periodDays == null || periodDays <= 0) {
        return { dateFrom: null, dateTo: null };
      }
      const n = Math.floor(periodDays);
      const from = todayMidnight - (n - 1) * MS_PER_DAY;
      const to = endOfLocalDay(todayMidnight);
      return { dateFrom: new Date(from), dateTo: new Date(to) };
    }
    case 'none':
    default:
      return { dateFrom: null, dateTo: null };
  }
}
