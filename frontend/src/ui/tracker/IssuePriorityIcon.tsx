"use client";

import { AlertCircle, ArrowUp, Minus, ArrowDown, Circle } from "lucide-react";
import { cn } from "@/ui/shadcn/lib/utils";
import { ISSUE_PRIORITY_LABELS, type IssuePriority } from "@/domain/tracker";

const ICON_BY_PRIORITY = {
  urgent: AlertCircle,
  high: ArrowUp,
  medium: Minus,
  low: ArrowDown,
  none: Circle,
} as const;

const COLOR_BY_PRIORITY: Record<IssuePriority, string> = {
  urgent: "text-danger",
  high: "text-warning",
  medium: "text-fg-secondary",
  low: "text-fg-tertiary",
  none: "text-fg-tertiary/60",
};

export function IssuePriorityIcon({
  priority,
  size = 14,
  className,
}: {
  priority: IssuePriority;
  size?: number;
  className?: string;
}) {
  const Icon = ICON_BY_PRIORITY[priority];
  return (
    <Icon
      size={size}
      className={cn("shrink-0", COLOR_BY_PRIORITY[priority], className)}
      aria-label={`Приоритет: ${ISSUE_PRIORITY_LABELS[priority]}`}
    />
  );
}
