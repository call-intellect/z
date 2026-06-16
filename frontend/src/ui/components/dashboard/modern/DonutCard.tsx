"use client";

import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { CardTitle } from "./CardTitle";
import { ChartTip } from "./ChartTip";
import { CHART, glass } from "./tokens";

export function DonutCard({
  title,
  icon,
  grad,
  data,
  centerValue,
  centerLabel,
}: {
  title: string;
  icon: ReactNode;
  grad: string;
  data: { name: string; value: number; c: string }[];
  centerValue?: string;
  centerLabel?: string;
}) {
  return (
    <div style={glass()} className="p-6">
      <CardTitle icon={icon} grad={grad}>
        {title}
      </CardTitle>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative h-[180px] w-[180px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={56}
                outerRadius={84}
                paddingAngle={3}
                stroke="none"
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.c} />
                ))}
              </Pie>
              <Tooltip content={<ChartTip />} />
            </PieChart>
          </ResponsiveContainer>
          {(centerValue || centerLabel) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              {centerValue && (
                <span className="text-2xl font-semibold leading-none">
                  {centerValue}
                </span>
              )}
              {centerLabel && (
                <span className="text-[11px]" style={{ color: CHART.faint }}>
                  {centerLabel}
                </span>
              )}
            </div>
          )}
        </div>
        <ul className="flex-1 space-y-2">
          {data.map((d) => (
            <li
              key={d.name}
              className="flex items-center justify-between text-sm"
            >
              <span
                className="flex items-center gap-2"
                style={{ color: CHART.dim }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: d.c }}
                />
                {d.name}
              </span>
              <span className="font-medium">{d.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
