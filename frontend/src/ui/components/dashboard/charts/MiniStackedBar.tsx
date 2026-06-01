'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/ui/shadcn/lib/utils';

import { toneVars, type ChartTone } from './tones';

export type StackedSegment = {
  value: number;
  tone: ChartTone;
  label?: string;
};

type Props = {
  segments: StackedSegment[];
  /** Высота полосы. По умолчанию 24. */
  height?: number;
  className?: string;
};

/**
 * MiniStackedBar — горизонтальная stacked-полоска из N сегментов с разными тонами.
 *
 * Реализована поверх `recharts` `BarChart` (`layout="vertical"`, одна строка).
 * Hover-tooltip с label + value — нативный recharts-tooltip; стилизован под
 * CSS-токены проекта (см. `IncomeChart`).
 *
 * Подходит для top-3 contributors в GoalVector, severity breakdown,
 * сегментации участников встречи и т.п.
 */
export function MiniStackedBar({ segments, height = 24, className }: Props) {
  const { row, keys } = useMemo(() => buildRow(segments), [segments]);

  if (segments.length === 0) {
    return (
      <div
        role="presentation"
        className={cn('h-6 w-full rounded bg-bg-overlay/40', className)}
        style={{ height }}
      />
    );
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={[row]}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={0}
        >
          <XAxis type="number" hide domain={[0, row.__total]} />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            cursor={{ fill: 'var(--bg-overlay)' }}
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            labelStyle={{ display: 'none' }}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : Number(value);
              return [String(num), String(name)];
            }}
          />
          {keys.map((key, i) => {
            const seg = segments[i]!;
            const { fg } = toneVars(seg.tone);
            return (
              <Bar
                key={key}
                dataKey={key}
                name={seg.label ?? `Сегмент ${i + 1}`}
                stackId="stack"
                fill={fg}
                fillOpacity={0.7}
                radius={
                  i === 0
                    ? [4, 0, 0, 4]
                    : i === keys.length - 1
                      ? [0, 4, 4, 0]
                      : 0
                }
                isAnimationActive={false}
              >
                <Cell fill={fg} fillOpacity={0.7} />
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildRow(segments: StackedSegment[]) {
  const row: Record<string, number | string> & { name: string; __total: number } = {
    name: 'row',
    __total: 0,
  };
  const keys: string[] = [];
  let total = 0;
  segments.forEach((s, i) => {
    const key = `s${i}`;
    const v = Math.max(0, s.value);
    row[key] = v;
    keys.push(key);
    total += v;
  });
  // Если все нули — рисуем единый плейсхолдер, чтобы recharts отрисовал серый бар.
  if (total === 0 && segments.length > 0) {
    row[keys[0]!] = 1;
    total = 1;
  }
  row.__total = total;
  return { row, keys };
}
