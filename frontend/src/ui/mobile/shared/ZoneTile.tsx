import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/ui/shadcn/lib/utils";
import { StatusDot, type StatusTone } from "./StatusDot";

interface ToneClasses {
  surface: string;
  value: string;
}

const TONE_CLASSES: Record<StatusTone, ToneClasses> = {
  ok: {
    surface: "bg-chip-success-bg border-transparent",
    value: "text-chip-success-fg",
  },
  warn: {
    surface: "bg-chip-warning-bg border-transparent",
    value: "text-chip-warning-fg",
  },
  danger: {
    surface: "bg-chip-danger-bg border-transparent",
    value: "text-chip-danger-fg",
  },
  neutral: {
    surface: "bg-bg-card border-border-subtle",
    value: "text-fg-primary",
  },
};

export interface ZoneTileProps {
  title: string;
  value: ReactNode;
  caption?: string;
  tone: StatusTone;
  href?: string;
  icon?: ReactNode;
}

export function ZoneTile({
  title,
  value,
  caption,
  tone,
  href,
  icon,
}: ZoneTileProps) {
  const t = TONE_CLASSES[tone];
  const inner = (
    <div
      className={cn(
        "flex h-full flex-col gap-1 rounded-2xl border p-4 transition-colors",
        t.surface,
        href && "active:opacity-80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
          {icon}
          {title}
        </span>
        <StatusDot tone={tone} />
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", t.value)}>
        {value}
      </div>
      {caption && <div className="text-xs text-fg-tertiary">{caption}</div>}
    </div>
  );

  if (!href) return inner;
  return (
    <Link
      href={href}
      className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-2xl"
    >
      {inner}
    </Link>
  );
}
