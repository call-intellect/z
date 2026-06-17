"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import useSWR from "swr";

import { dashboardApi } from "@/api/dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import type { PeopleAtRiskItemDomain } from "@/domain/people-at-risk";
import { peopleAtRiskFromApi } from "@/domain/people-at-risk";
import { Skeleton } from "@/ui/shadcn/skeleton";

export type PeopleAtRiskItem = PeopleAtRiskItemDomain;

export type PeopleAtRiskWidgetProps = {
  limit?: number;
};

export function PeopleAtRiskWidget({ limit = 3 }: PeopleAtRiskWidgetProps) {
  const { currentOrgId } = useAuth();

  const { data, error, isLoading } = useSWR(
    currentOrgId ? ["people-at-risk", currentOrgId, limit] : null,
    async () => {
      const res = await dashboardApi.peopleAtRisk(
        currentOrgId as string,
        limit,
      );
      return peopleAtRiskFromApi(res);
    },
  );

  if (error) return null;

  if (isLoading || !data) {
    return (
      <div className="rounded-2xl border border-border-subtle/60 bg-bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          Сотрудники под риском
        </h3>
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-3/4 rounded-lg" />
        </div>
      </div>
    );
  }

  const items = data.items;

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-chip-success-bg bg-chip-success-bg/15 px-4 py-3">
        <CheckCircle2 size={16} className="shrink-0 text-chip-success-fg" />
        <p className="text-sm text-fg-primary">
          Все сотрудники в норме — нет тех, кто проседает по Pulse.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-subtle/60 bg-bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
        Сотрудники под риском
      </h3>
      <ul className="space-y-2">
        {items.slice(0, limit).map((it) => {
          const tone =
            it.pulseScore < 30
              ? "danger"
              : it.pulseScore < 60
                ? "warning"
                : "success";
          const toneBg =
            tone === "danger"
              ? "bg-chip-danger-bg/15 hover:bg-chip-danger-bg/25"
              : tone === "warning"
                ? "bg-chip-warning-bg/15 hover:bg-chip-warning-bg/25"
                : "bg-chip-success-bg/15 hover:bg-chip-success-bg/25";
          const toneChip =
            tone === "danger"
              ? "bg-chip-danger-bg text-chip-danger-fg"
              : tone === "warning"
                ? "bg-chip-warning-bg text-chip-warning-fg"
                : "bg-chip-success-bg text-chip-success-fg";
          const initials = it.name
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
          return (
            <li key={it.personId}>
              <Link
                href={`/persons/${encodeURIComponent(it.personId)}/pulse`}
                aria-label={`${it.name}: ${it.topReason}`}
                className={`group flex items-center gap-3 rounded-lg p-2 transition-colors ${toneBg}`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-overlay text-xs font-medium text-fg-secondary">
                  {initials || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg-primary">
                    {it.name}
                  </div>
                  {it.department ? (
                    <div className="truncate text-xs text-fg-tertiary">
                      {it.department}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-sm text-fg-secondary">
                    {it.topReason}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${toneChip}`}
                  aria-hidden="true"
                >
                  {it.pulseScore}
                </span>
                <ArrowRight
                  size={14}
                  className="shrink-0 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
