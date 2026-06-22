"use client";

import type { FC } from "react";
import { useState } from "react";
import { Lightbulb } from "lucide-react";
import useSWR from "swr";

import { ideasApi, type IdeaClusterApi } from "@/api/ideas.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { Chip, PeopleDrawer } from "../_kit";

const GROWING_WEIGHT_THRESHOLD = 3;

function clusterName(cluster: IdeaClusterApi): string {
  const name = cluster.name?.trim();
  return name && name.toLowerCase() !== "null" ? name : "";
}

export const IdeasByThemeWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();
  const [active, setActive] = useState<IdeaClusterApi | null>(null);

  const clustersSwr = useSWR(
    currentOrgId ? ["ideas-clusters", currentOrgId] : null,
    async () => ideasApi.listClusters(1, 20),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const ideasSwr = useSWR(
    currentOrgId ? ["ideas-all", currentOrgId] : null,
    async () => ideasApi.list({}),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (clustersSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Lightbulb size={16} />} grad={GRAD.amber}>
          Идеи команды по темам
        </CardTitle>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </GlassCard>
    );
  }

  const clusters = clustersSwr.data?.items ?? [];
  if (clusters.length === 0) return null;

  const allIdeas = ideasSwr.data?.items ?? [];
  const activeIdeas = active
    ? allIdeas.filter((idea) => idea.clusterId === active.id)
    : [];

  return (
    <GlassCard>
      <CardTitle icon={<Lightbulb size={16} />} grad={GRAD.amber}>
        Идеи команды по темам
      </CardTitle>

      <div className="mt-4 space-y-2">
        {clusters.map((cluster) => {
          const growing = cluster.clusterWeight >= GROWING_WEIGHT_THRESHOLD;
          const name = clusterName(cluster);
          return (
            <button
              key={cluster.id}
              type="button"
              onClick={() => setActive(cluster)}
              className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:brightness-110"
              style={{ background: "var(--surface-inset)" }}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium"
                  style={{ color: CHART.text }}
                >
                  {name || "Без темы"}
                </span>
                <span
                  className="mt-0.5 block text-xs"
                  style={{ color: CHART.faint }}
                >
                  {cluster.ideaIds.length} идей
                </span>
              </span>
              <Chip tone={growing ? "ok" : "neutral"}>
                {growing ? "растёт" : "копится"}
              </Chip>
            </button>
          );
        })}
      </div>

      <PeopleDrawer
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
        title={(active && clusterName(active)) || "Идеи по теме"}
        subtitle="Что команда предлагает по этой теме"
      >
        {activeIdeas.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            {ideasSwr.isLoading
              ? "Загрузка идей…"
              : "Пока нет идей по этой теме."}
          </p>
        ) : (
          activeIdeas.map((idea) => (
            <div
              key={idea.id}
              className="rounded-xl p-3"
              style={{ background: "var(--surface-inset)" }}
            >
              <p className="text-sm" style={{ color: CHART.text }}>
                {idea.statement}
              </p>
              <p className="mt-1 text-xs" style={{ color: CHART.faint }}>
                {idea.supporterCount} поддержали
              </p>
            </div>
          ))
        )}
      </PeopleDrawer>
    </GlassCard>
  );
};
