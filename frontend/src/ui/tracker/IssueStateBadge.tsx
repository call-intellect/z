"use client";

import { Badge } from "@/ui/shadcn/badge";
import {
  ISSUE_STATE_CATEGORY_LABELS,
  type IssueStateCategory,
} from "@/domain/tracker";

const VARIANT_BY_CATEGORY: Record<
  IssueStateCategory,
  "default" | "secondary" | "outline" | "success" | "warning" | "danger"
> = {
  backlog: "secondary",
  unstarted: "outline",
  started: "default",
  completed: "success",
  cancelled: "danger",
};

export function IssueStateBadge({
  category,
  label,
  className,
}: {
  category: IssueStateCategory;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant={VARIANT_BY_CATEGORY[category]} className={className}>
      {label ?? ISSUE_STATE_CATEGORY_LABELS[category]}
    </Badge>
  );
}
