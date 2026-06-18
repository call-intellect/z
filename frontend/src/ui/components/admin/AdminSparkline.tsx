"use client";

import { useId, useMemo } from "react";

import { cn } from "@/ui/shadcn/lib/utils";

export type AdminSparklinePoint = {
  x: string | number;
  y: number;
};

type Props = {
  data: AdminSparklinePoint[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
};

export function AdminSparkline({
  data,
  color = "var(--accent)",
  width = 120,
  height = 40,
  className,
  ariaLabel,
}: Props) {
  const id = useId();

  const view = useMemo(() => {
    if (data.length === 0) return null;
    const ys = data.map((p) => p.y);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;

    const normY = (v: number): number => height - ((v - min) / range) * height;

    const points = data
      .map((p, i) => `${i * stepX},${normY(p.y).toFixed(2)}`)
      .join(" ");

    const area = `M0,${height} L${data
      .map((p, i) => `${i * stepX},${normY(p.y).toFixed(2)}`)
      .join(" L")} L${width},${height} Z`;

    return { points, area };
  }, [data, width, height]);

  if (!view) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={cn("block", className)}
      />
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? "Спарклайн"}
      className={cn("block", className)}
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={view.area} fill={`url(#spark-${id})`} />
      <polyline
        points={view.points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
