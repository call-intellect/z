"use client";

import Link from "next/link";
import { ChevronLeft, Slash } from "lucide-react";

import { useIssue } from "@/hooks/tracker/useIssue";
import type { Issue } from "@/domain/tracker";

export function IssueBreadcrumb({
  orgId,
  parentIssueId,
  currentIssue,
}: {
  orgId: string;
  parentIssueId: string;
  currentIssue: Issue;
}) {
  const { issue: parent, isLoading, error } = useIssue(orgId, parentIssueId);

  if (isLoading) {
    return (
      <div className="mb-3 h-5 w-64 animate-pulse rounded bg-bg-overlay" />
    );
  }
  if (error || !parent) {
    return null;
  }

  return (
    <nav
      className="mb-3 flex items-center gap-1 text-xs text-fg-tertiary"
      aria-label="Хлебные крошки"
    >
      <Link
        href={`/issues/${encodeURIComponent(parent.id)}`}
        className="inline-flex items-center gap-1 hover:underline"
      >
        <ChevronLeft size={12} />
        <span className="font-mono">{parent.identifier}</span>
        <span className="max-w-[24ch] truncate text-fg-secondary">
          «{parent.title}»
        </span>
      </Link>
      <Slash size={10} className="text-fg-tertiary" />
      <span className="font-mono">{currentIssue.identifier}</span>
      <span className="max-w-[24ch] truncate text-fg-secondary">
        «{currentIssue.title}»
      </span>
    </nav>
  );
}
