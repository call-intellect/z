"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { cn } from "@/ui/shadcn/lib/utils";

import { autoTone, toneVars, type ChartTone } from "./tones";

type Props = {
  value: number;
  tone?: ChartTone;
  size?: number;
  centerLabel?: string;
  className?: string;
};

export function MiniDonut({
  value,
  tone,
  size = 28,
  centerLabel,
  className,
}: Props) {
  const isInvalid = !Number.isFinite(value);
  const safeValue = isInvalid ? 0 : Math.max(0, Math.min(value, 1));
  const resolvedTone: ChartTone =
    tone ?? (isInvalid ? "neutral" : autoTone(safeValue));
  const { fg } = toneVars(resolvedTone);

  const data = useMemo(
    () => [
      { name: "filled", value: safeValue },
      { name: "rest", value: Math.max(0, 1 - safeValue) },
    ],
    [safeValue],
  );

  const outerR = size / 2;
  const innerR = outerR * 0.7;

  const renderedLabel = isInvalid ? "—" : centerLabel;

  return (
    <div
      className={cn("relative inline-block", className)}
      style={{ width: size, height: size }}
      role={renderedLabel ? "img" : "presentation"}
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
            <Cell
              fill={isInvalid ? "var(--bg-overlay)" : fg}
              fillOpacity={isInvalid ? 0.4 : 0.9}
            />
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
