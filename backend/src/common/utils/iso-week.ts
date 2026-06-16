export function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function lastWeekBoundsMsk(now: Date): {
  weekStart: Date;
  weekEnd: Date;
  isoWeek: string;
} {
  const mskNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = mskNow.getUTCFullYear();
  const m = mskNow.getUTCMonth();
  const d = mskNow.getUTCDate();
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay() || 7;
  const mondayThisWeek = new Date(Date.UTC(y, m, d - (dow - 1), -3, 0, 0, 0));
  const weekStart = new Date(mondayThisWeek);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const weekEnd = mondayThisWeek;
  const mid = new Date((weekStart.getTime() + weekEnd.getTime()) / 2);
  return { weekStart, weekEnd, isoWeek: isoWeekLabel(mid) };
}
