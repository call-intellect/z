'use client';

import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { cn } from '@/ui/shadcn/lib/utils';

import { autoTone, toneVars, type ChartTone } from './tones';

type Props = {
  /** Доля в диапазоне 0..1. NaN/undefined трактуются как «нет данных». */
  value: number;
  tone?: ChartTone;
  /** Внешний размер кольца в px. */
  size?: number;
  /** Текст в центре — например, "65%". Если опущен — ничего. */
  centerLabel?: string;
  className?: string;
};

/**
 * MiniDonut — тонкое кольцо для health-score, RBAC-coverage, donut-KPI.
 *
 * Внутренний радиус 70% от внешнего, заполненная часть — `var(--{tone}-fg)`,
 * пустая — `var(--bg-overlay)` (нейтрально-тёмный/светлый из tokens.css).
 * Если `value` не передано / NaN — пустое кольцо + «—» в центре.
 *
 * Тон выбирается автоматически по значению (см. `autoTone`), если не задан явно.
 */
export function MiniDonut({
  value,
  tone,
  size = 28,
  centerLabel,
  className,
}: Props) {
  const isInvalid = !Number.isFinite(value);
  const safeValue = isInvalid ? 0 : Math.max(0, Math.min(value, 1));
  const resolvedTone: ChartTone = tone ?? (isInvalid ? 'neutral' : autoTone(safeValue));
  const { fg } = toneVars(resolvedTone);

  const data = useMemo(
    () => [
      { name: 'filled', value: safeValue },
      { name: 'rest', value: Math.max(0, 1 - safeValue) },
    ],
    [safeValue],
  );

  // Радиусы в процентах не используются — recharts ожидает px. Считаем сами.
  const outerR = size / 2;
  const innerR = outerR * 0.7;

  const renderedLabel = isInvalid ? '—' : centerLabel;

  return (
    <div
      className={cn('relative inline-block', className)}
      style={{ width: size, height: size }}
      role={renderedLabel ? 'img' : 'presentation'}
      aria-label={renderedLabel ? `Прогресс ${renderedLabel}` : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={innerR}
            outerRadius={outerR}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={isInvalid ? 'var(--bg-overlay)' : fg} fillOpacity={isInvalid ? 0.4 : 0.9} />
            <Cell fill="var(--bg-overlay)" fillOpacity={0.5} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {renderedLabel && (
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-fg-primary"
          aria-hidden="true"
        >
          {renderedLabel}
        </span>
      )}
    </div>
  );
}
