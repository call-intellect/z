/**
 * Тон-палитра для библиотеки мини-визуализаций (Фаза 2 ТЗ
 * `plans/tz/2026-06-01-dashboards-wow-polish.md`).
 *
 * В `tokens.css` сейчас есть только `chip-{success|warning|danger|info|lavender|sand}-{bg,fg}`,
 * НО НЕТ `chip-accent-*` / `chip-neutral-*`. Чтобы props у компонентов всё-таки
 * принимали удобный кортеж `'success'|'warning'|'danger'|'accent'|'neutral'`,
 * мы маппим `accent` → `--accent` / `--accent-muted`, а `neutral` → нейтральные
 * fg/bg-токены. Это даёт корректную работу темы (OKLCH-токены меняются
 * автоматически в light/dark) без введения новых переменных.
 */

export type ChartTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

export type ToneVars = {
  /** Цвет линии/обводки/заполненной части. */
  fg: string;
  /** Цвет заливки фона / пустой части. */
  bg: string;
};

const TONE_VARS: Record<ChartTone, ToneVars> = {
  success: { fg: 'var(--chip-success-fg)', bg: 'var(--chip-success-bg)' },
  warning: { fg: 'var(--chip-warning-fg)', bg: 'var(--chip-warning-bg)' },
  danger: { fg: 'var(--chip-danger-fg)', bg: 'var(--chip-danger-bg)' },
  accent: { fg: 'var(--accent)', bg: 'var(--accent-muted)' },
  neutral: { fg: 'var(--text-tertiary)', bg: 'var(--bg-overlay)' },
};

export function toneVars(tone: ChartTone): ToneVars {
  return TONE_VARS[tone];
}

/**
 * Автоматический выбор тона по доле 0..1.
 *   <0.3 → danger
 *   0.3..0.7 → warning
 *   ≥0.7 → success
 */
export function autoTone(ratio: number): ChartTone {
  if (Number.isNaN(ratio)) return 'neutral';
  if (ratio < 0.3) return 'danger';
  if (ratio < 0.7) return 'warning';
  return 'success';
}
