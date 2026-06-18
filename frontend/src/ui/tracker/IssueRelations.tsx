"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft, Link2 } from "lucide-react";
import { useIssueRelations } from "@/hooks/tracker/useIssueRelations";
import {
  ISSUE_RELATION_TYPE_LABELS,
  type IssueRelationType,
} from "@/domain/tracker";

export function IssueRelations({
  orgId,
  issueId,
}: {
  orgId: string;
  issueId: string;
}) {
  const { relations, isLoading, error } = useIssueRelations(orgId, issueId);

  if (isLoading) {
    return (
      <div className="h-10 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
    );
  }

  if (error) {
    return (
      <div className="text-sm text-danger">Не удалось загрузить связи.</div>
    );
  }

  if (relations.length === 0) {
    return <div className="text-sm text-fg-tertiary">Связей нет.</div>;
  }

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {relations.map((r) => {
        const Arrow = r.direction === "out" ? ArrowRight : ArrowLeft;
        const otherId =
          r.direction === "out" ? r.targetIssueId : r.sourceIssueId;
        const label =
          ISSUE_RELATION_TYPE_LABELS[r.relationType as IssueRelationType] ??
          r.relationType;
        return (
          <li
            key={r.id}
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
          >
            <Link2 size={12} className="text-fg-tertiary" />
            <span className="text-xs uppercase tracking-wider text-fg-tertiary">
              {label}
            </span>
            <Arrow size={12} className="text-fg-tertiary" />
            <Link
              href={`/issues/${encodeURIComponent(otherId)}`}
              className="font-mono text-xs text-accent hover:underline"
            >
              {otherId.slice(0, 8)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
