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
