'use client';

import type { ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { CardTitle } from './CardTitle';
import { ChartTip } from './ChartTip';
import { Legend } from './Legend';
import { CHART, glass } from './tokens';

/**
 * Обобщённый area-график на стеклянной карточке. Покрывает витринный
 * `RevenueHero`/`AreaHero`: опциональный заголовок, опциональный крупный
 * headline + автолегенда по сериям, затем AreaChart с отдельным linearGradient
 * на каждую серию (id строится из `series.key`).
 */
export function AreaTrend({
  title,
  titleIcon,
  titleGrad,
  data,
  xKey,
  series,
  height = 260,
  headline,
}: {
  title?: string;
  titleIcon?: ReactNode;
  titleGrad?: string;
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; color: string; label: string; strokeWidth?: number; fillOpacity?: number }[];
  height?: number;
  headline?: { value: string; sub: string; subColor?: string };
}) {
  const gradId = (key: string) => `area-${key}`;
  return (
    <div style={glass()} className="p-6">
      {(title || headline) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && (
              <CardTitle icon={titleIcon} grad={titleGrad ?? GRAD_FALLBACK}>
                {title}
              </CardTitle>
            )}
            {headline && (
              <div className="mt-2 flex items-end gap-3">
                <span className="text-[32px] font-semibold leading-none tracking-tight">
                  {headline.value}
                </span>
                <span className="pb-1 text-sm" style={{ color: headline.subColor ?? 'var(--chip-success-fg)' }}>
                  {headline.sub}
                </span>
              </div>
            )}
          </div>
          <Legend items={series.map((s) => ({ c: s.color, t: s.label }))} />
        </div>
      )}
      <div className="mt-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={gradId(s.key)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={s.fillOpacity ?? 0.45} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey={xKey}
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART.faint, fontSize: 12 }}
            />
            <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--border-strong)' }} />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={s.strokeWidth ?? 2}
                fill={`url(#${gradId(s.key)})`}
                dot={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Дефолтный градиент иконки, если заголовок задан без `titleGrad`. */
const GRAD_FALLBACK = 'linear-gradient(135deg, oklch(0.86 0.15 168), oklch(0.74 0.13 205))';
