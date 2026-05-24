'use client';

import type { ReactNode } from 'react';
import { cn } from '@/ui/shadcn/lib/utils';
import { Sparkline } from './Sparkline';

type Delta = {
  value: number;
  label?: string;
};

type Props = {
  label: string;
  value: ReactNode;
  delta?: Delta;
  sparkline?: number[];
  sparklineVariant?: 'bar' | 'line';
  variant?: 'default' | 'dark';
  className?: string;
};

/**
 * StatCard — бордерлесс-карточка KPI с двойной мягкой тенью.
 * variant='dark' — принудительный dark surface как визуальный якорь
 * в KPI strip даже в светлой теме.
 */
export function StatCard({
  label,
  value,
  delta,
  sparkline,
  sparklineVariant = 'line',
  variant = 'default',
  className,
}: Props) {
  const isDark = variant === 'dark';

  const surface = isDark
    ? 'bg-[oklch(0.22_0.016_250)] text-[oklch(0.93_0.005_250)]'
    : 'bg-bg-card text-fg-primary';

  const labelTone = isDark
    ? 'text-[oklch(0.72_0.008_250)]'
    : 'text-fg-secondary';

  const deltaTone =
    delta && delta.value >= 0
      ? isDark
        ? 'text-[oklch(0.82_0.13_150)]'
        : 'text-success'
      : isDark
        ? 'text-[oklch(0.82_0.13_22)]'
        : 'text-danger';

  const accentColor = isDark
    ? 'oklch(0.84 0.13 168)'
    : 'var(--accent)';

  const deltaArrow = delta ? (delta.value >= 0 ? '↑' : '↓') : null;
  const deltaText = delta
    ? `${deltaArrow} ${Math.abs(delta.value)}${
        delta.label ? ` · ${delta.label}` : '%'
      }`
    : null;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl p-5 shadow-card-soft',
        surface,
        className,
      )}
      data-variant={variant}
    >
      <div className={cn('text-xs font-medium uppercase tracking-wide', labelTone)}>
        {label}
      </div>
      <div className="text-3xl font-semibold leading-tight">{value}</div>
      <div className="flex items-end justify-between gap-3">
        {deltaText ? (
          <div className={cn('text-sm font-medium', deltaTone)}>{deltaText}</div>
        ) : (
          <span />
        )}
        {sparkline && sparkline.length > 0 ? (
          <Sparkline
            data={sparkline}
            variant={sparklineVariant}
            color={accentColor}
            width={88}
            height={28}
          />
        ) : null}
      </div>
    </div>
  );
}
