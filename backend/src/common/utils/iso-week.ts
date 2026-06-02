/**
 * ISO-week хелперы (RFC 8601-week, понедельник — первый день).
 *
 * Вынесено из `recognition-weekly-digest.cron.ts` (где `isoWeek` был приватным)
 * для переиспользования в Goals OKR v2 Фаза 4 (еженедельный пульс целей).
 */

/**
 * ISO-week label: `YYYY-WXX` для данной даты (по UTC-компонентам).
 *
 * Для МСК (UTC+3) на этапе MVP различие границы недели в UTC vs МСК
 * несущественно для еженедельного отчёта (как и в daily/weekly digest).
 */
export function isoWeekLabel(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Границы [start, end) прошедшей недели (пн 00:00 — след. пн 00:00) в МСК,
 * выраженные в UTC, относительно момента `now`. Используется пульсом целей:
 * cron бежит в понедельник — отчёт за ПРОШЛУЮ неделю.
 *
 * МСК = UTC+3 без DST. Понедельник прошлой недели в МСК = `now` округлён вниз
 * до понедельника текущей недели минус 7 дней.
 */
export function lastWeekBoundsMsk(now: Date): {
  weekStart: Date;
  weekEnd: Date;
  isoWeek: string;
} {
  // Текущий момент в МСК-компонентах.
  const mskNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = mskNow.getUTCFullYear();
  const m = mskNow.getUTCMonth();
  const d = mskNow.getUTCDate();
  // День недели (1=пн..7=вс) по МСК-дате.
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay() || 7;
  // Понедельник текущей недели в МСК (00:00 МСК = 21:00 UTC предыдущих суток).
  // 00:00 МСК соответствует UTC-часу -3.
  const mondayThisWeek = new Date(Date.UTC(y, m, d - (dow - 1), -3, 0, 0, 0));
  // Прошлая неделя: [понедельник−7д, понедельник).
  const weekStart = new Date(mondayThisWeek);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const weekEnd = mondayThisWeek;
  // isoWeek прошлой недели — берём середину окна, чтобы не зацепить край.
  const mid = new Date((weekStart.getTime() + weekEnd.getTime()) / 2);
  return { weekStart, weekEnd, isoWeek: isoWeekLabel(mid) };
}

/** YYYY-MM-DD из Date по UTC-компонентам (для подписи периода). */
export function isoDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
