'use client';

import { cn } from '@/ui/shadcn/lib/utils';

import { autoTone, toneVars, type ChartTone } from './tones';

type Props = {
  value: number;
  /** Если 0 — рисуем пустую полоску. */
  max: number;
  tone?: ChartTone;
  /** Подпись слева — например, название метрики. */
  label?: string;
  /** Суффикс справа после числа — `%`, `руб.` и т.п. */
  suffix?: string;
  className?: string;
};

/**
 * MiniBarRow — горизонтальная полоска прогресса от 0 до max.
 *
 * Используется для ROI, goal progress, mention count. Если `tone` не передан —
 * выбирается автоматически: <30% → danger, 30..70% → warning, ≥70% → success.
 *
 * a11y: имеет роль `progressbar` с `aria-valuemin/max/now`. Подпись и значение
 * рендерятся текстом (для скринридеров достаточно `aria-label`-fallback по
 * `label`).
 */
export function MiniBarRow({
  value,
  max,
  tone,
  label,
  suffix,
  className,
}: Props) {
  const safeMax = Math.max(0, max);
  const safeValue = Math.max(0, Math.min(value, safeMax));
  const ratio = safeMax > 0 ? safeValue / safeMax : 0;
  const resolvedTone: ChartTone = tone ?? autoTone(ratio);
  const { fg } = toneVars(resolvedTone);

  const widthPct = `${(ratio * 100).toFixed(1)}%`;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && (
        <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">
          {label}
        </span>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        aria-label={label}
        className={cn(
          'relative h-1.5 flex-1 overflow-hidden rounded-full bg-bg-overlay/60',
          label ? 'min-w-[40px]' : 'min-w-0',
        )}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{
            width: widthPct,
            backgroundColor: fg,
            opacity: 0.7,
          }}
        />
      </div>
      {(suffix !== undefined || value !== undefined) && (
        <span className="shrink-0 text-xs tabular-nums text-fg-secondary">
          {formatValue(value)}
          {suffix ? ` ${suffix}` : ''}
        </span>
      )}
    </div>
  );
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}
