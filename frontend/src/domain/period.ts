export type ReportRhythm = "day" | "week" | "month";

const RU_MONTHS_NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

const RU_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

function parseYmd(
  dateYmd: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function toYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftDate(dateYmd: string, days: number): string {
  const parsed = parseYmd(dateYmd);
  if (!parsed) return dateYmd;
  const base = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days),
  );
  return toYmd(base);
}

export function mondayOf(dateYmd: string): string {
  const parsed = parseYmd(dateYmd);
  if (!parsed) return dateYmd;
  const base = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  const dow = base.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return shiftDate(dateYmd, diff);
}

export function shiftWeek(weekStartYmd: string, weeks: number): string {
  return shiftDate(weekStartYmd, weeks * 7);
}

export function shiftPeriodYm(periodYm: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
  if (!m) return periodYm;
  const year = Number(m[1]);
  const monthIdx0 = Number(m[2]) - 1;
  const total = year * 12 + monthIdx0 + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

export function shiftPeriod(
  rhythm: ReportRhythm,
  value: string,
  delta: number,
): string {
  switch (rhythm) {
    case "day":
      return shiftDate(value, delta);
    case "week":
      return shiftWeek(value, delta);
    case "month":
      return shiftPeriodYm(value, delta);
  }
}

function formatDayLabel(dateYmd: string): string {
  const parsed = parseYmd(dateYmd);
  if (!parsed) return dateYmd;
  const month = RU_MONTHS_GENITIVE[parsed.month - 1];
  if (!month) return dateYmd;
  return `${parsed.day} ${month} ${parsed.year}`;
}

function formatWeekLabel(weekStartYmd: string): string {
  const start = parseYmd(weekStartYmd);
  if (!start) return weekStartYmd;
  const endYmd = shiftDate(weekStartYmd, 6);
  const end = parseYmd(endYmd);
  if (!end) return weekStartYmd;
  const startMonth = RU_MONTHS_GENITIVE[start.month - 1];
  const endMonth = RU_MONTHS_GENITIVE[end.month - 1];
  if (!startMonth || !endMonth) return weekStartYmd;
  if (start.month === end.month && start.year === end.year) {
    return `${start.day}–${end.day} ${endMonth} ${end.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${startMonth} – ${end.day} ${endMonth} ${end.year}`;
  }
  return `${start.day} ${startMonth} ${start.year} – ${end.day} ${endMonth} ${end.year}`;
}

function formatMonthLabel(periodYm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
  if (!m) return periodYm;
  const year = m[1];
  const month = RU_MONTHS_NOMINATIVE[Number(m[2]) - 1];
  if (!month) return periodYm;
  return `${month} ${year}`;
}

export function formatPeriodLabel(
  rhythm: ReportRhythm,
  value: string,
): string {
  switch (rhythm) {
    case "day":
      return formatDayLabel(value);
    case "week":
      return formatWeekLabel(value);
    case "month":
      return formatMonthLabel(value);
  }
}

export function currentPeriod(rhythm: ReportRhythm): string {
  const now = new Date();
  const today = toYmd(now);
  switch (rhythm) {
    case "day":
      return today;
    case "week":
      return mondayOf(today);
    case "month":
      return today.slice(0, 7);
  }
}

export function comparePeriods(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
