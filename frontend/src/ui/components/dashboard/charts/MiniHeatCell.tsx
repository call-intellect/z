"use client";

import { cn } from "@/ui/shadcn/lib/utils";

import { toneVars, type ChartTone } from "./tones";

type Props = {
  ratio: number;
  tone?: ChartTone;
  value?: string | number;
  size?: number;
  className?: string;
};

export function MiniHeatCell({
  ratio,
  tone = "danger",
  value,
  size = 32,
  className,
}: Props) {
  const safeRatio = Math.max(
    0,
    Math.min(1, Number.isFinite(ratio) ? ratio : 0),
  );
  const isEmpty = safeRatio <= 0;
  const { fg, bg } = toneVars(tone);

  const computedOpacity = isEmpty
    ? undefined
    : 0.6 + Math.max(0.12, safeRatio) * 0.4;

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md text-xs font-medium tabular-nums transition-opacity",
        isEmpty ? "bg-bg-overlay/40 text-fg-tertiary" : "",
        className,
      )}
      style={{
        width: size,
        height: size,
        ...(isEmpty
          ? {}
          : {
              backgroundColor: bg,
              color: fg,
              opacity: computedOpacity,
            }),
      }}
      aria-hidden="true"
    >
      {value !== undefined && value !== "" ? String(value) : ""}
    </div>
  );
}
