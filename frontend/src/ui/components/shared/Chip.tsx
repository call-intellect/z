"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/ui/shadcn/lib/utils";

type ChipVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "lavender"
  | "sand";

type Props = HTMLAttributes<HTMLSpanElement> & {
  variant: ChipVariant;
  size?: "sm" | "md";
  children: ReactNode;
};

const VARIANT_CLASS: Record<ChipVariant, string> = {
  success: "bg-chip-success-bg text-chip-success-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  danger: "bg-chip-danger-bg text-chip-danger-fg",
  info: "bg-chip-info-bg text-chip-info-fg",
  lavender: "bg-chip-lavender-bg text-chip-lavender-fg",
  sand: "bg-chip-sand-bg text-chip-sand-fg",
};

const SIZE_CLASS = {
  sm: "h-5 px-2 text-[11px]",
  md: "h-6 px-2.5 text-xs",
};

export function Chip({
  variant,
  size = "md",
  className,
  children,
  ...rest
}: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm font-medium leading-none",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
