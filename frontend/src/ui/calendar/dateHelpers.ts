export const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

export const HOUR_HEIGHT_PX = 48;
export const FIRST_HOUR = 6;
export const LAST_HOUR = 22;
export const VISIBLE_HOURS = LAST_HOUR - FIRST_HOUR + 1;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  return x;
}

export function endOfWeek(d: Date): Date {
  return endOfDay(addDays(startOfWeek(d), 6));
}

export function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  return endOfDay(x);
}

export function monthGridStart(d: Date): Date {
  return startOfWeek(startOfMonth(d));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

export function formatMonthLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatWeekRangeLabel(d: Date): string {
  const start = startOfWeek(d);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTH_NAMES[start.getMonth()]} — ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

export function formatTimeHM(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function eventDayPositionPx(
  startAt: Date,
  endAt: Date,
  dayStart: Date,
): { topPx: number; heightPx: number } {
  const dayBeginMin = FIRST_HOUR * 60;
  const dayEndMin = (LAST_HOUR + 1) * 60;
  const startMin = Math.max(
    dayBeginMin,
    (startAt.getTime() - dayStart.getTime()) / 60000,
  );
  const endMin = Math.min(
    dayEndMin,
    (endAt.getTime() - dayStart.getTime()) / 60000,
  );
  const topPx = ((startMin - dayBeginMin) / 60) * HOUR_HEIGHT_PX;
  const heightPx = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT_PX);
  return { topPx, heightPx };
}

export function moveDateToDay(source: Date, targetDay: Date): Date {
  const r = new Date(targetDay);
  r.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), 0);
  return r;
}
