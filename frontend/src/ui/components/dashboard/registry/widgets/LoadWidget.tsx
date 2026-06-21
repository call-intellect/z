"use client";

import type { FC } from "react";
import { useState } from "react";
import { Gauge } from "lucide-react";
import useSWR from "swr";

import {
  executionDashboardApi,
  type LoadByPersonLevel,
} from "@/api/execution-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { Chip, PeopleDrawer, PersonRow } from "../_kit";

const LEVEL_CHIP: Record<LoadByPersonLevel, "risk" | "ok" | "warn"> = {
  overload: "risk",
  normal: "ok",
  idle: "warn",
};

const LEVEL_LABEL: Record<LoadByPersonLevel, string> = {
  overload: "перегруз",
  normal: "норма",
  idle: "недогруз",
};

export const LoadWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadSwr = useSWR(
    currentOrgId ? ["load-by-person", currentOrgId] : null,
    async () => executionDashboardApi.getLoadByPerson(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (loadSwr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Gauge size={16} />} grad={GRAD.blue}>
          Кто чем загружен
        </CardTitle>
        <Skeleton className="mt-4 h-24" />
      </GlassCard>
    );
  }

  const rows = loadSwr.data?.rows ?? [];
  if (rows.length === 0) return null;

  const overload = rows.filter((r) => r.level === "overload").length;
  const normal = rows.filter((r) => r.level === "normal").length;
  const idle = rows.filter((r) => r.level === "idle").length;

  return (
    <GlassCard>
      <CardTitle icon={<Gauge size={16} />} grad={GRAD.blue}>
        Кто чем загружен
      </CardTitle>

      <p className="mt-2 text-sm" style={{ color: CHART.dim }}>
        Карта нагрузки — куда перекинуть задачи.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip tone="risk">Перегруз {overload}</Chip>
        <Chip tone="ok">Норма {normal}</Chip>
        <Chip tone="warn">Недогруз {idle}</Chip>
      </div>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="mt-4 inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition hover:brightness-110"
        style={{
          background: "var(--surface-inset-strong)",
          color: CHART.text,
        }}
      >
        По людям
      </button>

      <PeopleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="По людям — карта нагрузки"
        subtitle="Куда перекинуть задачи, чтобы выровнять команду"
      >
        {rows.map((row) => (
          <PersonRow
            key={row.userId}
            name={row.personName}
            sub={`${row.activeTasks} задач в работе`}
            right={
              <Chip tone={LEVEL_CHIP[row.level]}>{LEVEL_LABEL[row.level]}</Chip>
            }
          />
        ))}
      </PeopleDrawer>
    </GlassCard>
  );
};
