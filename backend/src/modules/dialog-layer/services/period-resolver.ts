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

export const PERIOD_DETECT_CONFIDENT = 0.9;

const YESTERDAY_PATTERN = /вчера/i;
const TODAY_PATTERN = /сегодня/i;
const LAST_N_DAYS_PATTERN = /за\s+(?:последн(?:ие|их)\s+)?(\d{1,3})\s*(?:дн|сут)/i;
const LAST_WEEK_PATTERNS: RegExp[] = [
  /за\s+(?:прошл(?:ую|ой)|последн(?:юю|ей)|прошедш(?:ую|ей))\s+недел[юияе]/i,
  /(?:на|за)\s+прошл(?:ой|ую)\s+недел[юияе]/i,
  /за\s+недел[юе]/i,
];
const THIS_WEEK_PATTERNS: RegExp[] = [
  /(?:на|за)\s+(?:эт(?:ой|у|ой)|текущ(?:ей|ую))\s+недел[юияе]/i,
];
const LAST_MONTH_PATTERNS: RegExp[] = [
  /за\s+прошл(?:ый|ом)\s+месяц[ае]?/i,
  /(?:в|за)\s+прошл(?:ом|ый)\s+месяц[ае]?/i,
  /прошл(?:ый|ом)\s+месяц[ае]?/i,
];
const THIS_MONTH_PATTERNS: RegExp[] = [
  /за\s+(?:эт(?:от|ом)|текущ(?:ий|ем))\s+месяц[ае]?/i,
  /(?:в|за)\s+(?:эт(?:ом|от)|текущ(?:ем|ий))\s+месяц[ае]?/i,
  /эт(?:от|ом)\s+месяц[ае]?/i,
];

export function detectPeriodExpr(question: string): {
  expr: PeriodExpr;
  periodDays: number | null;
  confidence: number;
} {
  const q = typeof question === 'string' ? question : '';

  if (YESTERDAY_PATTERN.test(q)) {
    return { expr: 'yesterday', periodDays: null, confidence: PERIOD_DETECT_CONFIDENT };
  }
  if (TODAY_PATTERN.test(q)) {
    return { expr: 'today', periodDays: null, confidence: PERIOD_DETECT_CONFIDENT };
  }

  const nDays = LAST_N_DAYS_PATTERN.exec(q);
  if (nDays) {
    const n = Number.parseInt(nDays[1]!, 10);
    if (Number.isFinite(n) && n > 0) {
      return { expr: 'last_n_days', periodDays: n, confidence: PERIOD_DETECT_CONFIDENT };
    }
  }

  for (const p of LAST_WEEK_PATTERNS) {
    if (p.test(q)) return { expr: 'last_week', periodDays: null, confidence: PERIOD_DETECT_CONFIDENT };
  }
  for (const p of THIS_WEEK_PATTERNS) {
    if (p.test(q)) return { expr: 'this_week', periodDays: null, confidence: PERIOD_DETECT_CONFIDENT };
  }
  for (const p of LAST_MONTH_PATTERNS) {
    if (p.test(q)) return { expr: 'last_month', periodDays: null, confidence: PERIOD_DETECT_CONFIDENT };
  }
  for (const p of THIS_MONTH_PATTERNS) {
    if (p.test(q)) return { expr: 'this_month', periodDays: null, confidence: PERIOD_DETECT_CONFIDENT };
  }

  return { expr: 'none', periodDays: null, confidence: 0 };
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
