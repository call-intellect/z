/**
 * Редизайн кабинета Ф8.2 — чистая логика silence-детектора тем.
 * Без зависимостей от Prisma/NestJS (unit-тестируется без БД).
 *
 * Идея: тема, у которой последний сигнал (`Theme.lastSignalAt`) старше
 * порога `themeSilenceWeeks`, «молчит» — её перестали обсуждать, но решение
 * могло остаться невнедрённым. Surface как риск (Insight kind='risk').
 */

import type { InsightSeverity } from '@prisma/client';

/** Порог молчания по умолчанию (недель). Крутилка `dashboard.theme_silence_weeks`. */
export const DEFAULT_THEME_SILENCE_WEEKS = 3;

/** Префикс-маркер для `Insight.causeCategory`, кодирующий themeId (идемпотентность). */
export const THEME_SILENCE_CAUSE_PREFIX = 'ts:';

/** Сколько дней в неделе (для перевода порога в миллисекунды). */
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 24 * 3_600_000;

/**
 * Маркер `causeCategory` для silence-Insight конкретной темы.
 * cuid ≈ 25 символов, префикс `ts:` = 3 → влезает в `VarChar(40)` без миграции.
 * Точный (а не fuzzy по statement) ключ идемпотентности.
 */
export function themeSilenceCauseCategory(themeId: string): string {
  return `${THEME_SILENCE_CAUSE_PREFIX}${themeId}`.slice(0, 40);
}

/**
 * Граница «молчания»: сигналы строго раньше неё считаются протухшими.
 * `cutoff = now - weeks*7d`. Тема с `lastSignalAt < cutoff` → молчит.
 * Чистая функция.
 */
export function silenceCutoff(now: Date, weeks: number): Date {
  const w = safePositive(weeks, DEFAULT_THEME_SILENCE_WEEKS);
  return new Date(now.getTime() - w * DAYS_PER_WEEK * MS_PER_DAY);
}

/** Целое число полных недель молчания (по `lastSignalAt`). Чистая. */
export function weeksSilent(lastSignalAt: Date, now: Date): number {
  const diffMs = now.getTime() - lastSignalAt.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (DAYS_PER_WEEK * MS_PER_DAY));
}

/**
 * Острота риска по давности молчания. Чистая функция.
 *   - >= 12 недель → critical (тема заброшена кварталом)
 *   - >= 6 недель  → high
 *   - иначе (>= порог) → medium
 */
export function classifySilenceSeverity(weeks: number): InsightSeverity {
  if (weeks >= 12) return 'critical';
  if (weeks >= 6) return 'high';
  return 'medium';
}

/**
 * Текст риска для Insight (user-facing, русский). Чистая функция.
 * Имя темы обрезается, чтобы общий statement остался читаемым.
 */
export function buildSilenceStatement(themeName: string, weeks: number): string {
  const name = (themeName || 'Без названия').trim().slice(0, 160);
  return `Тема «${name}» молчит ${weeks} ${pluralWeeks(weeks)}: сигналов нет, решение могло остаться невнедрённым.`;
}

/** Русское склонение «неделя/недели/недель». */
export function pluralWeeks(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'недель';
  if (last > 1 && last < 5) return 'недели';
  if (last === 1) return 'неделю';
  return 'недель';
}

function safePositive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
