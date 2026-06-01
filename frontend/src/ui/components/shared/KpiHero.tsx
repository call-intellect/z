'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { Sparkline } from './Sparkline';
import { CountUp } from '@/ui/components/dashboard/charts';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * KpiHero — display-карточка KPI для главного дашборда (Pulse Wave 1 §1.5).
 *
 * Threshold semantic:
 *   - `normal` (default): зелёный если value ≥ green, жёлтый если value ≥ yellow,
 *     иначе красный.
 *   - `inverted` (меньше = лучше, напр. «висящие решения»): зелёный если
 *     value ≤ green, жёлтый если value ≤ yellow, иначе красный.
 *
 * Цвета — через семантические токены `chip-success-fg / chip-warning-fg /
 * chip-danger-fg` (см. `src/ui/tokens.css`). На фоне `bg-card`. Sparkline
 * наследует цвет тона через CSS-var.
 */

export type KpiThreshold = {
  green: number;
  yellow: number;
  inverted?: boolean;
};

export type KpiHeroProps = {
  /** Короткий заголовок над цифрой. */
  label: string;
  /** Главное число (или ReactNode, например "42%"). */
  value: ReactNode;
  /** Дельта к предыдущему окну. Положительная зелёная в normal-режиме. */
  delta?: number | null;
  /** Текст для дельты ("за 14 дней"). */
  deltaLabel?: string;
  /** Trend (для KPI без числовой дельты, напр. sentiment). */
  trend?: 'up' | 'flat' | 'down';
  /** Данные sparkline (может содержать null gaps). */
  sparkline?: Array<number | null>;
  /** Порог цветов для value. Если undefined — нейтральный цвет. */
  threshold?: KpiThreshold;
  /** Числовое value для threshold-проверки (если value ReactNode). */
  numericValue?: number;
  /**
   * Форматтер для CountUp-анимации. Если задан вместе с `numericValue`,
   * `value` игнорируется при рендере цифры и используется `format(n)`.
   * Если не задан, но `value === number` (или передан `numericValue`),
   * число анимируется с дефолтным форматтером CountUp.
   */
  format?: (n: number) => string;
  /** Drill-down href. */
  href?: string;
  /** Дополнительный класс. */
  className?: string;
};

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function thresholdTone(value: number, threshold?: KpiThreshold): Tone {
  if (!threshold) return 'neutral';
  if (threshold.inverted) {
    if (value <= threshold.green) return 'success';
    if (value <= threshold.yellow) return 'warning';
    return 'danger';
  }
  if (value >= threshold.green) return 'success';
  if (value >= threshold.yellow) return 'warning';
  return 'danger';
}

const VALUE_TONE_CLASS: Record<Tone, string> = {
  success: 'text-chip-success-fg',
  warning: 'text-chip-warning-fg',
  danger: 'text-chip-danger-fg',
  neutral: 'text-fg-primary',
};

const ACCENT_BAR_CLASS: Record<Tone, string> = {
  success: 'bg-chip-success-fg/60',
  warning: 'bg-chip-warning-fg/60',
  danger: 'bg-chip-danger-fg/60',
  neutral: 'bg-accent/40',
};

const SPARKLINE_COLOR: Record<Tone, string> = {
  success: 'var(--chip-success-fg)',
  warning: 'var(--chip-warning-fg)',
  danger: 'var(--chip-danger-fg)',
  neutral: 'var(--accent)',
};

export function KpiHero({
  label,
  value,
  delta,
  deltaLabel,
  trend,
  sparkline,
  threshold,
  numericValue,
  format,
  href,
  className,
}: KpiHeroProps) {
  const v =
    typeof numericValue === 'number'
      ? numericValue
      : typeof value === 'number'
        ? value
        : 0;
  const tone = thresholdTone(v, threshold);

  // Решение об анимации:
  //   - если `format` задан — анимируем `numericValue` (или v) через format,
  //     это покрывает «42%», «1.2k» и т.п.
  //   - если `value` — голое число, анимируем его дефолтным форматтером.
  //   - иначе рендерим `value` как есть (ReactNode/строка остаются без анимации,
  //     чтобы не ломать существующий API).
  const renderedValue: ReactNode = (() => {
    if (format) return <CountUp to={v} format={format} />;
    if (typeof value === 'number') return <CountUp to={value} />;
    return value;
  })();

  // sparkline c null → 0 для отрисовки. Может быть улучшено в будущем
  // (gap-rendering в Sparkline пока не поддерживается).
  const sparklineData = (sparkline ?? []).map((x) => (x === null ? 0 : x));

  const inner = (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-4 overflow-hidden rounded-xl bg-bg-card p-5 shadow-card-soft transition-all duration-150',
        href && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-card-raised',
        className,
      )}
      data-tone={tone}
    >
      {/* Цветной акцент сбоку — мягкий сигнал тона без перегруза. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-0 h-full w-0.5 transition-opacity',
          ACCENT_BAR_CLASS[tone],
        )}
      />

      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-secondary">
        {label}
      </div>
      <div
        className={cn(
          'text-5xl font-semibold leading-none tabular-nums md:text-6xl',
          VALUE_TONE_CLASS[tone],
        )}
      >
        {renderedValue}
      </div>
      <div className="flex items-end justify-between gap-3">
        <DeltaOrTrend delta={delta} deltaLabel={deltaLabel} trend={trend} />
        {sparklineData.length > 0 ? (
          <Sparkline
            data={sparklineData}
            color={SPARKLINE_COLOR[tone]}
            width={96}
            height={28}
            variant="line"
          />
        ) : null}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`Подробнее: ${label}`}
        className="block h-full"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

function DeltaOrTrend({
  delta,
  deltaLabel,
  trend,
}: {
  delta?: number | null;
  deltaLabel?: string;
  trend?: 'up' | 'flat' | 'down';
}) {
  if (typeof delta === 'number') {
    const positive = delta >= 0;
    const Icon = positive ? ArrowUpRight : ArrowDownRight;
    return (
      <div
        className={cn(
          'flex items-center gap-1 text-sm font-medium',
          positive ? 'text-chip-success-fg' : 'text-chip-danger-fg',
        )}
      >
        <Icon size={14} />
        {positive ? '+' : ''}
        {Number(delta).toFixed(0)}
        {deltaLabel && (
          <span className="text-fg-tertiary"> · {deltaLabel}</span>
        )}
      </div>
    );
  }
  if (trend) {
    const Icon =
      trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
    const toneClass =
      trend === 'up'
        ? 'text-chip-success-fg'
        : trend === 'down'
          ? 'text-chip-danger-fg'
          : 'text-fg-tertiary';
    const text =
      trend === 'up' ? 'растёт' : trend === 'down' ? 'падает' : 'без изменений';
    return (
      <div className={cn('flex items-center gap-1 text-sm font-medium', toneClass)}>
        <Icon size={14} />
        <span>{text}</span>
      </div>
    );
  }
  return <span />;
}
