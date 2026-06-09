'use client';

import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import { CHART } from './tokens';
import { glass } from './tokens';

/**
 * KPI-карточка: градиентная иконка, дельта-плашка, крупное значение, подпись и
 * мини-спарклайн (recharts area). Разметка и стили 1-в-1 из витрины.
 */
export function StatCard({
  icon,
  grad,
  label,
  value,
  delta,
  up,
  spark,
  tone,
}: {
  icon: ReactNode;
  grad: string;
  label: string;
  value: string;
  delta: string;
  up: boolean;
  spark: { i: number; v: number }[];
  tone: string;
}) {
  return (
    <div style={glass({ borderRadius: 20 })} className="p-5">
      <div className="flex items-start justify-between">
        <div
          className="grid h-11 w-11 place-items-center rounded-2xl"
          style={{ background: grad, color: CHART.text, boxShadow: `0 10px 24px -10px ${tone}` }}
        >
          {icon}
        </div>
        <span
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
          style={{
            color: up ? CHART.mint : CHART.amber,
            background: up ? 'oklch(0.85 0.15 165 / 0.12)' : 'oklch(0.84 0.16 80 / 0.12)',
          }}
        >
          {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {delta}
        </span>
      </div>
      <div className="mt-4 text-[30px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 flex items-end justify-between">
        <span className="text-sm" style={{ color: CHART.dim }}>
          {label}
        </span>
        <div className="h-8 w-20">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={spark} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`sp-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tone} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={tone} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={tone}
                strokeWidth={2}
                fill={`url(#sp-${label})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
