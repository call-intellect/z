/**
 * SBA β-8 — Утилиты для работы с IANA таймзонами Person'а.
 *
 * Используем `Intl.DateTimeFormat` (стандарт ES2020) — без сторонних либ.
 * Невалидная TZ → fallback на 'Europe/Moscow'.
 */

const DEFAULT_TIMEZONE = 'Europe/Moscow';

/**
 * Получить локальный час (0..23) для конкретной TZ.
 */
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
      // Edge-case: Intl возвращает "24" в полночь в некоторых runtime'ах.
      if (value === 24) return 0;
      return value;
    }
    return now.getUTCHours();
  } catch {
    // Невалидная TZ → fallback на UTC, но не падаем.
    return now.getUTCHours();
  }
}

/**
 * Получить локальную дату YYYY-MM-DD для конкретной TZ.
 */
export function getLocalDate(now: Date, timezone: string | null | undefined): string {
  const tz = timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA даёт YYYY-MM-DD.
    return fmt.format(now);
  } catch {
    // Fallback на UTC дату.
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Получить минуты с начала дня (0..1439) для конкретной TZ. Используется
 * для сравнения с окном «тихих часов» `HH:mm-HH:mm` в локальном времени
 * пользователя. Невалидная TZ → fallback на UTC-минуты дня.
 */
export function getLocalMinutesOfDay(
  now: Date,
  timezone: string | null | undefined,
): number {
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
    const m = minutePart
      ? Number.parseInt(minutePart.value, 10)
      : now.getUTCMinutes();
    if (!Number.isFinite(h)) h = now.getUTCHours();
    if (h === 24) h = 0; // edge-case полночь в некоторых runtime'ах
    const mm = Number.isFinite(m) ? m : now.getUTCMinutes();
    return h * 60 + mm;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Внутри ли локальное время пользователя окна «тихих часов»
 * (`HH:mm-HH:mm`, в TZ пользователя). Невалидное окно → false (не тихо).
 * Поддерживает окна через полночь (start > end).
 */
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
  // Окно через полночь.
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * Проверить, что строка таймзоны валидна (Intl поддерживает).
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_TIMEZONE };
