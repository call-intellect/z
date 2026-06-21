"use client";

import type { FC } from "react";
import Link from "next/link";
import { ArrowRight, Link2 } from "lucide-react";
import useSWR from "swr";

import { executionDashboardApi } from "@/api/execution-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";

export const IssueChainsWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const period = rhythm === "today" ? "day" : rhythm;

  const chainsSwr = useSWR(
    currentOrgId ? ["issue-chains", currentOrgId, period] : null,
    async () =>
      executionDashboardApi.getIssueChains(currentOrgId!, {
        period,
        limit: 20,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (chainsSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Link2 size={16} />} grad={GRAD.pink}>
          Задача держит задачу
        </CardTitle>
        <Skeleton className="mt-4 h-24" />
      </GlassCard>
    );
  }

  const chains = chainsSwr.data?.chains ?? [];
  if (chains.length === 0) return null;

  return (
    <GlassCard>
      <CardTitle icon={<Link2 size={16} />} grad={GRAD.pink}>
        Задача держит задачу
      </CardTitle>

      <ul className="mt-4 space-y-2">
        {chains.map((chain) => (
          <li
            key={`${chain.sourceIssueId}-${chain.targetIssueId}-${chain.relationType}`}
            className="flex flex-wrap items-center gap-2 rounded-xl p-2.5 text-sm"
            style={{ background: "var(--surface-inset)" }}
          >
            <Link
              href={`/issues/${chain.sourceIssueId}`}
              className="font-medium transition hover:brightness-110"
              style={{ color: CHART.text }}
            >
              {chain.sourceIdentifier} {chain.sourceTitle}
            </Link>
            <span
              className="inline-flex items-center gap-1 text-xs font-medium"
              style={{ color: CHART.faint }}
            >
              <ArrowRight size={13} />
              {chain.relationType === "blocks" ? "держит" : "ждёт"}
              <ArrowRight size={13} />
            </span>
            <Link
              href={`/issues/${chain.targetIssueId}`}
              className="font-medium transition hover:brightness-110"
              style={{ color: CHART.text }}
            >
              {chain.targetIdentifier} {chain.targetTitle}
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
};
