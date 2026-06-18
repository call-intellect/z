"use client";

import type { ReactNode } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

import { CardTitle } from "./CardTitle";
import { CHART, glass } from "./tokens";

export function RadarCard({
  title,
  icon,
  grad,
  data,
}: {
  title: string;
  icon: ReactNode;
  grad: string;
  data: { k: string; v: number }[];
}) {
  return (
    <div style={glass()} className="p-6">
      <CardTitle icon={icon} grad={grad}>
        {title}
      </CardTitle>
      <div className="mt-2 h-[220px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RadarChart data={data} outerRadius="72%">
            <defs>
              <linearGradient id="radar" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={CHART.violet} stopOpacity={0.6} />
                <stop offset="100%" stopColor={CHART.cyan} stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <PolarGrid stroke="var(--border-inset)" />
            <PolarAngleAxis
              dataKey="k"
              tick={{ fill: CHART.dim, fontSize: 11 }}
            />
            <Radar
              dataKey="v"
              stroke={CHART.violet}
              strokeWidth={2}
              fill="url(#radar)"
              fillOpacity={1}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
