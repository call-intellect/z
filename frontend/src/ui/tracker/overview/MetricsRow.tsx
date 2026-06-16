"use client";

import type { OverviewMetricsApi } from "@/domain/tracker/overview";

interface KpiTile {
  label: string;
  value: number;
  variant?: "default" | "warn";
}

export function MetricsRow({ metrics }: { metrics: OverviewMetricsApi }) {
  const tiles: KpiTile[] = [
    { label: "Всего задач", value: metrics.totalIssues },
    { label: "В работе", value: metrics.inProgressIssues },
    {
      label: "Просрочено",
      value: metrics.overdueIssues,
      variant: metrics.overdueIssues > 0 ? "warn" : "default",
    },
    { label: "Завершено за 7 дней", value: metrics.completedLast7d },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={
            t.variant === "warn"
              ? "rounded-lg border border-chip-danger-bg bg-chip-danger-bg/30 p-3"
              : "rounded-lg border border-border-subtle bg-bg-elevated p-3"
          }
        >
          <div
            className={
              t.variant === "warn"
                ? "text-xs uppercase tracking-wide text-chip-danger-fg"
                : "text-xs uppercase tracking-wide text-fg-tertiary"
            }
          >
            {t.label}
          </div>
          <div
            className={
              t.variant === "warn"
                ? "mt-1 text-2xl font-semibold text-chip-danger-fg"
                : "mt-1 text-2xl font-semibold text-fg-primary"
            }
          >
            {t.value.toLocaleString("ru-RU")}
          </div>
        </div>
      ))}
    </section>
  );
}
