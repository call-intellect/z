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

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_TIMEZONE };
