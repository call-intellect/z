const DEFAULT_TIMEZONE = 'Europe/Moscow';

export function getLocalHour(now: Date, timezone: string | null | undefined): number {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    if (!hourPart) return now.getUTCHours();
    const value = Number.parseInt(hourPart.value, 10);
    if (Number.isFinite(value)) {
      if (value === 24) return 0;
      return value;
    }
    return now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

export function getLocalDate(now: Date, timezone: string | null | undefined): string {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(now);
  } catch {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

export function getLocalMinutesOfDay(now: Date, timezone: string | null | undefined): number {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    const minutePart = parts.find((p) => p.type === 'minute');
    let h = hourPart ? Number.parseInt(hourPart.value, 10) : now.getUTCHours();
    const m = minutePart ? Number.parseInt(minutePart.value, 10) : now.getUTCMinutes();
    if (!Number.isFinite(h)) h = now.getUTCHours();
    if (h === 24) h = 0;
    const mm = Number.isFinite(m) ? m : now.getUTCMinutes();
    return h * 60 + mm;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

export function isWithinQuietHours(
  now: Date,
  timezone: string | null | undefined,
  quietHours: string | null | undefined,
): boolean {
  if (!quietHours) return false;
  const match = quietHours.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) return false;
  const startMin = Number(match[1]) * 60 + Number(match[2]);
  const endMin = Number(match[3]) * 60 + Number(match[4]);
  if (startMin === endMin) return false;
  const nowMin = getLocalMinutesOfDay(now, timezone);
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

export function getLocalWeekday(now: Date, timezone: string | null | undefined): string {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'long' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(now);
  }
}

export function getLocalTime(now: Date, timezone: string | null | undefined): string {
  const total = getLocalMinutesOfDay(now, timezone);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildNowContextLine(now: Date, timezone: string | null | undefined): string {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  const date = getLocalDate(now, tz);
  const weekday = getLocalWeekday(now, tz);
  const time = getLocalTime(now, tz);
  return `Сейчас: ${date} (${weekday}), ${time} по таймзоне пользователя (${tz}). «сегодня» = эта дата, «завтра» = эта дата +1 день; любое относительное время («в 10:00», «через час») понимай в этой таймзоне.`;
}

export function localDayBoundsUtc(
  moment: Date,
  timezone: string | null | undefined,
): { startOfDayUtc: Date; dayOfWeek: number } {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(moment);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    let hh = Number(get('hour'));
    const mm = Number(get('minute'));
    const ss = Number(get('second'));
    if (hh === 24) hh = 0;
    const wdMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = wdMap[get('weekday')] ?? 0;
    const sinceMidnight = ((hh * 60 + mm) * 60 + ss) * 1000;
    const startOfDayUtc = new Date(moment.getTime() - sinceMidnight);
    return { startOfDayUtc, dayOfWeek };
  } catch {
    const startOfDayUtc = new Date(moment);
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    return { startOfDayUtc, dayOfWeek: moment.getUTCDay() };
  }
}

export function startOfLocalDayUtc(
  now: Date,
  timezone: string | null | undefined,
): Date {
  return localDayBoundsUtc(now, timezone).startOfDayUtc;
}

export function localDayWindowUtc(
  now: Date,
  timezone: string | null | undefined,
): { from: Date; to: Date } {
  const from = startOfLocalDayUtc(now, timezone);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60_000) };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_TIMEZONE };
