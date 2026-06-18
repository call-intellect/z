"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { CardTitle } from "./CardTitle";
import { ChartTip } from "./ChartTip";
import { CHART, glass } from "./tokens";

export function BarTrend({
  title,
  icon,
  grad,
  data,
  xKey,
  dataKey,
  height = 220,
}: {
  title: string;
  icon: ReactNode;
  grad: string;
  data: Record<string, unknown>[];
  xKey: string;
  dataKey: string;
  height?: number;
}) {
  return (
    <div style={glass()} className="p-6">
      <CardTitle icon={icon} grad={grad}>
        {title}
      </CardTitle>
      <div className="mt-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -22 }}
          >
            <defs>
              <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.cyan} />
                <stop
                  offset="100%"
                  stopColor={CHART.violet}
                  stopOpacity={0.7}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey={xKey}
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART.faint, fontSize: 12 }}
            />
            <Tooltip
              content={<ChartTip />}
              cursor={{ fill: "var(--surface-inset)" }}
            />
            <Bar
              dataKey={dataKey}
              radius={[8, 8, 0, 0]}
              fill="url(#bar)"
              maxBarSize={34}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
