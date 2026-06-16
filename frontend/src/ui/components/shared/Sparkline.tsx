"use client";

import { useId } from "react";

type Props = {
  data: number[];
  variant?: "bar" | "line";
  color?: string;
  width?: number;
  height?: number;
  className?: string;
};

export function Sparkline({
  data,
  variant = "line",
  color = "var(--accent)",
  width = 96,
  height = 28,
  className,
}: Props) {
  const id = useId();

  if (!data.length) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={className}
      />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  const norm = (v: number) => height - ((v - min) / range) * height;

  if (variant === "bar") {
    const slot = data.length > 0 ? width / data.length : width;
    const barW = Math.max(2, slot * 0.7);
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={className}
      >
        {data.map((v, i) => {
          const y = norm(v);
          const x = i * slot + (slot - barW) / 2;
          return (
            <rect
              key={`${id}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, height - y)}
              rx={1.5}
              fill={color}
              opacity={0.85}
            />
          );
        })}
      </svg>
    );
  }

  const points = data.map((v, i) => `${i * stepX},${norm(v)}`).join(" ");
  const area = `M0,${height} L${points
    .split(" ")
    .map((p) => p)
    .join(" L")} L${width},${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={`spk-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spk-${id})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
