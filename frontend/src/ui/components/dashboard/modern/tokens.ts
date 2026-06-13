/**
 * Токены нового («современного») визуального языка дашбордов Коры
 * (редизайн 2026-06-08).
 *
 * Источник правды по стилю — витрина `app/(design-preview)/redesign/page.tsx`,
 * одобренная владельцем. Здесь те же значения вынесены в переиспользуемый
 * TS-модуль, который потребляют компоненты `modern/*` и боевые дашборды.
 *
 * ВАЖНО: recharts-градиентам (`<stop stopColor>`) нужны литеральные цвета, а не
 * CSS-переменные, поэтому ЯРКИЕ data-цвета (violet…red) скопированы 1-в-1 из
 * витрины и НЕ заменяются на `var(--*)` — они читаемы и на тёмной, и на светлой.
 *
 * Редизайн 2026-06-13 (Ф10, светлая тема): текстовые цвета (`text/dim/faint`),
 * стеклянная поверхность (`glass()`) и фон страницы (`MODERN_PAGE_BG`) переведены
 * на CSS-переменные из `tokens.css` — они flip-аются по `[data-theme]`. SVG-`fill`
 * принимает `var(--*)` (это не gradient-stop), поэтому подписи осей/легенд тоже
 * адаптируются к теме.
 *
 * Это НЕ 'use client' модуль — чистые данные и хелперы.
 */

import type { CSSProperties } from 'react';

/* ------------------------------------------------------------------ */
/* Палитра графиков (объект `C`): текст — тема-зависим (var), data — литералы */
/* ------------------------------------------------------------------ */

export const CHART = {
  text: 'var(--text-primary)',
  dim: 'var(--text-secondary)',
  faint: 'var(--text-tertiary)',
  violet: 'oklch(0.66 0.2 300)',
  indigo: 'oklch(0.62 0.2 278)',
  blue: 'oklch(0.7 0.16 245)',
  cyan: 'oklch(0.8 0.13 205)',
  teal: 'oklch(0.82 0.13 178)',
  mint: 'oklch(0.85 0.15 165)',
  lime: 'oklch(0.86 0.19 130)',
  amber: 'oklch(0.84 0.16 80)',
  orange: 'oklch(0.74 0.18 50)',
  pink: 'oklch(0.74 0.2 350)',
  red: 'oklch(0.66 0.22 25)',
} as const;

/* ------------------------------------------------------------------ */
/* Градиенты для иконок/плашек (объект `GRAD` из витрины)              */
/* ------------------------------------------------------------------ */

export const GRAD = {
  violet: 'linear-gradient(135deg, oklch(0.7 0.2 300), oklch(0.58 0.2 268))',
  blue: 'linear-gradient(135deg, oklch(0.74 0.15 240), oklch(0.62 0.18 270))',
  teal: 'linear-gradient(135deg, oklch(0.86 0.15 168), oklch(0.74 0.13 205))',
  amber: 'linear-gradient(135deg, oklch(0.86 0.16 85), oklch(0.72 0.18 45))',
  pink: 'linear-gradient(135deg, oklch(0.78 0.2 350), oklch(0.62 0.2 300))',
} as const;

/* ------------------------------------------------------------------ */
/* Стеклянная поверхность (хелпер `glass()` из витрины)               */
/* ------------------------------------------------------------------ */

/**
 * Inline-стиль «стеклянной» карточки: тонированный градиент, тонкая рамка,
 * мягкая тень и backdrop-blur. `extra` мёржится поверх (можно переопределить
 * radius/background и т.п.).
 */
export function glass(extra?: CSSProperties): CSSProperties {
  return {
    background: 'var(--glass-surface)',
    border: '1px solid var(--glass-border)',
    borderRadius: 22,
    boxShadow: 'var(--glass-shadow)',
    backdropFilter: 'var(--glass-blur)',
    WebkitBackdropFilter: 'var(--glass-blur)',
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* Фон страницы (корневой `<div style={{ background }}>` из витрины)   */
/* ------------------------------------------------------------------ */

/**
 * Фоновый градиент страницы дашборда. Тема-зависим: значение живёт в
 * `tokens.css` (`--modern-page-bg`) и flip-ается по `[data-theme]` (тёмные блики
 * на тёмном / приглушённые на светлом).
 */
export const MODERN_PAGE_BG: string = 'var(--modern-page-bg)';

/* ------------------------------------------------------------------ */
/* Тона статусов (объект `STATUS` из витрины, ключи переведены в en)   */
/* ------------------------------------------------------------------ */

/**
 * Цвет текста + фон плашки по статусу. Ключи — английские (`ok|warning|risk`),
 * значения — те же oklch, что в витрине (ок→ok, внимание→warning, риск→risk).
 */
export const STATUS_TONE: Record<'ok' | 'warning' | 'risk', { c: string; bg: string }> = {
  ok: { c: 'var(--chip-success-fg)', bg: 'var(--chip-success-bg)' },
  warning: { c: 'var(--chip-warning-fg)', bg: 'var(--chip-warning-bg)' },
  risk: { c: 'var(--chip-danger-fg)', bg: 'var(--chip-danger-bg)' },
};

/* ------------------------------------------------------------------ */
/* Цвет тона KPI по порогу (порт KpiHero.thresholdTone)               */
/* ------------------------------------------------------------------ */

/**
 * Цвет тона для KPI по порогу (порт KpiHero.thresholdTone).
 * normal: value>=green→mint, >=yellow→amber, иначе red.
 * inverted (меньше=лучше): value<=green→mint, <=yellow→amber, иначе red.
 * threshold отсутствует → нейтральный CHART.dim.
 */
export function kpiTone(
  value: number,
  threshold?: { green: number; yellow: number; inverted?: boolean },
): string {
  if (!threshold) return CHART.dim;
  if (threshold.inverted) {
    if (value <= threshold.green) return CHART.mint;
    if (value <= threshold.yellow) return CHART.amber;
    return CHART.red;
  }
  if (value >= threshold.green) return CHART.mint;
  if (value >= threshold.yellow) return CHART.amber;
  return CHART.red;
}
