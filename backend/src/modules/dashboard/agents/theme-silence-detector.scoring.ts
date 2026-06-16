import type { InsightSeverity } from '@prisma/client';

export const DEFAULT_THEME_SILENCE_WEEKS = 3;

export const THEME_SILENCE_CAUSE_PREFIX = 'ts:';

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 24 * 3_600_000;

export function themeSilenceCauseCategory(themeId: string): string {
  return `${THEME_SILENCE_CAUSE_PREFIX}${themeId}`.slice(0, 40);
}

export function silenceCutoff(now: Date, weeks: number): Date {
  const w = safePositive(weeks, DEFAULT_THEME_SILENCE_WEEKS);
  return new Date(now.getTime() - w * DAYS_PER_WEEK * MS_PER_DAY);
}

export function weeksSilent(lastSignalAt: Date, now: Date): number {
  const diffMs = now.getTime() - lastSignalAt.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (DAYS_PER_WEEK * MS_PER_DAY));
}

export function classifySilenceSeverity(weeks: number): InsightSeverity {
  if (weeks >= 12) return 'critical';
  if (weeks >= 6) return 'high';
  return 'medium';
}

export function buildSilenceStatement(themeName: string, weeks: number): string {
  const name = (themeName || 'Без названия').trim().slice(0, 160);
  return `Тема «${name}» молчит ${weeks} ${pluralWeeks(weeks)}: сигналов нет, решение могло остаться невнедрённым.`;
}

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
