"use client";

import type { OperationsTeamTemperaturePersonApi } from "@/api/operations-dashboard.api";
import { cn } from "@/ui/shadcn/lib/utils";

export type TeamTemperatureHeatmapProps = {
  byPerson: OperationsTeamTemperaturePersonApi[];
  className?: string;
};

export function TeamTemperatureHeatmap({
  byPerson,
  className,
}: TeamTemperatureHeatmapProps) {
  if (byPerson.length === 0) {
    return (
      <p className={cn("text-sm text-fg-tertiary", className)}>
        Чек-инов с проанализированным настроением пока нет.
      </p>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {byPerson.slice(0, 20).map((p) => {
        const score = p.total > 0 ? (p.green - p.red) / p.total : 0;
        const tone: "success" | "warning" | "danger" =
          score >= 0.3 ? "success" : score >= 0 ? "warning" : "danger";
        return (
          <div key={p.personId} className="flex items-center gap-3">
            <span
              className="w-40 shrink-0 truncate text-sm text-fg-secondary"
              title={p.personName ?? "Без имени"}
            >
              {p.personName ?? "Без имени"}
            </span>
            <div className="flex flex-1 gap-1">
              {Array.from({ length: p.total }, (_, i) => {
                const cellTone: "success" | "warning" | "danger" =
                  i < p.red
                    ? "danger"
                    : i < p.red + p.yellow
                      ? "warning"
                      : "success";
                return (
                  <div
                    key={i}
                    className={cn(
                      "h-4 flex-1 rounded-sm",
                      cellTone === "success" && "bg-chip-success-bg",
                      cellTone === "warning" && "bg-chip-warning-bg",
                      cellTone === "danger" && "bg-chip-danger-bg",
                    )}
                    title={`Чек-ин #${i + 1}: ${
                      cellTone === "success"
                        ? "зелёный"
                        : cellTone === "warning"
                          ? "жёлтый"
                          : "красный"
                    }`}
                  />
                );
              })}
            </div>
            <span
              className={cn(
                "w-12 shrink-0 text-right text-xs font-medium",
                tone === "success" && "text-chip-success-fg",
                tone === "warning" && "text-chip-warning-fg",
                tone === "danger" && "text-chip-danger-fg",
              )}
              title={`Индекс настроения = (зелёные − красные) / всего`}
            >
              {p.total > 0 ? `${Math.round(score * 100)}` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
