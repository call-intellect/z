'use client';

import type { ReactNode } from 'react';
import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from 'recharts';

import { CardTitle } from './CardTitle';
import { CHART, glass } from './tokens';

/**
 * Карточка-«спидометр»: полукруглый RadialBar с градиентом, крупное значение в
 * центре и опциональный 3-колоночный футер с метриками.
 * Data-driven версия витринного `GaugeCard`.
 */
export function GaugeCard({
  title,
  icon,
  grad,
  value,
  max = 100,
  footer,
}: {
  title: string;
  icon: ReactNode;
  grad: string;
  value: number;
  max?: number;
  footer?: { t: string; v: string; c: string }[];
}) {
  // RadialBar домен фиксируем 0..100, поэтому нормируем значение к процентам.
  const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={glass()} className="flex flex-col p-6">
      <CardTitle icon={icon} grad={grad}>
        {title}
      </CardTitle>
      <div className="relative mt-2 flex-1">
        <div className="h-[210px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <RadialBarChart
              innerRadius="68%"
              outerRadius="100%"
              data={[{ name: 'h', value: pct }]}
              startAngle={210}
              endAngle={-30}
            >
              <defs>
                <linearGradient id="gauge" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={CHART.violet} />
                  <stop offset="60%" stopColor={CHART.cyan} />
                  <stop offset="100%" stopColor={CHART.mint} />
                </linearGradient>
              </defs>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar
                background={{ fill: 'oklch(1 0 0 / 0.06)' }}
                dataKey="value"
                cornerRadius={20}
                fill="url(#gauge)"
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[40px] font-semibold leading-none tracking-tight">{value}</span>
          <span className="mt-1 text-xs" style={{ color: CHART.faint }}>
            из {max}
          </span>
        </div>
      </div>
      {footer && footer.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {footer.map((s) => (
            <div key={s.t} className="rounded-xl py-2" style={{ background: 'oklch(1 0 0 / 0.04)' }}>
              <div className="text-sm font-semibold" style={{ color: s.c }}>
                {s.v}
              </div>
              <div className="text-[11px]" style={{ color: CHART.faint }}>
                {s.t}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
