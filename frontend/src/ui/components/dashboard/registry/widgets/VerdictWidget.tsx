"use client";

import type { FC } from "react";
import { useState } from "react";
import useSWR from "swr";

import { dashboardApi } from "@/api/dashboard.api";
import { directorDashboardFromApi } from "@/domain/director-dashboard";
import { useAuth } from "@/contexts/auth-context";
import { VerdictBar } from "@app/(authenticated)/dashboard/widgets/VerdictBar";
import { CHART } from "@/ui/components/dashboard/modern";

import type { Rhythm } from "../types";
import { Chip, PeopleDrawer } from "../_kit";

const SOURCE_LABELS: ReadonlyArray<{
  key: "conflict" | "intake" | "probe" | "curation";
  label: string;
}> = [
  { key: "conflict", label: "Конфликты" },
  { key: "intake", label: "Задачи из встреч" },
  { key: "probe", label: "Уточнения Коры" },
  { key: "curation", label: "Кураторские" },
];

export const VerdictWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const period = rhythm === "month" ? "month" : "week";

  const swr = useSWR(
    currentOrgId ? ["verdict-director", currentOrgId, period] : null,
    async () =>
      directorDashboardFromApi(
        await dashboardApi.getDirectorView(currentOrgId!, period),
      ),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const total = swr.data?.requiresAction?.total ?? 0;
  const degraded = swr.data?.degraded ?? false;
  const bySource = swr.data?.requiresAction?.bySource ?? {
    conflict: 0,
    intake: 0,
    probe: 0,
    curation: 0,
  };

  const subtitle = degraded
    ? null
    : total === 0
      ? "Ничего не ждёт — спокойное утро"
      : null;

  return (
    <div className="space-y-2">
      <VerdictBar requiresCount={total} down={degraded} subtitle={subtitle} />

      {total > 0 && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition hover:brightness-110"
          style={{
            background: "var(--surface-inset-strong)",
            color: CHART.text,
          }}
        >
          Ждут тебя: {total}
        </button>
      )}

      <PeopleDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Что ждёт твоего решения"
        subtitle="Разберём по источникам — где нужна твоя рука"
      >
        {SOURCE_LABELS.filter((s) => bySource[s.key] > 0).length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Пока ничего не ждёт.
          </p>
        ) : (
          SOURCE_LABELS.filter((s) => bySource[s.key] > 0).map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between rounded-xl p-3"
              style={{ background: "var(--surface-inset)" }}
            >
              <span className="text-sm" style={{ color: CHART.text }}>
                {s.label}
              </span>
              <Chip tone={s.key === "conflict" ? "risk" : "warn"}>
                {bySource[s.key]}
              </Chip>
            </div>
          ))
        )}
      </PeopleDrawer>
    </div>
  );
};
