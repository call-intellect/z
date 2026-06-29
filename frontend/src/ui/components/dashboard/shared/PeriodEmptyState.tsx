"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import { CHART } from "@/ui/components/dashboard/modern";

type PeriodEmptyStateSurface = "day" | "week" | "month";

type PeriodEmptyStateProps = {
  surface: PeriodEmptyStateSurface;
  hasOtherPeriods: boolean;
  periodLabel: string;
  onJumpNearest: () => void;
  onToLatest: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
};

const SURFACE_BREAKDOWN: Record<PeriodEmptyStateSurface, string> = {
  day: "ежедневный разбор компании",
  week: "недельный разбор компании",
  month: "месячный разбор компании",
};

export function PeriodEmptyState({
  surface,
  hasOtherPeriods,
  periodLabel,
  onJumpNearest,
  onToLatest,
  onRegenerate,
  isRegenerating,
}: PeriodEmptyStateProps) {
  if (hasOtherPeriods) {
    return (
      <div
        className="flex flex-col items-start gap-3 p-7"
        style={{
          background: "var(--glass-surface)",
          border: "1px solid var(--glass-border)",
          borderRadius: 24,
        }}
      >
        <h2 className="text-lg font-semibold" style={{ color: CHART.text }}>
          За {periodLabel} отчёта нет
        </h2>
        <p className="text-sm" style={{ color: CHART.dim }}>
          За этот период Кора отчёт не собирала.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onJumpNearest}>
            Перейти к ближайшему доступному
          </Button>
          <Button variant="outline" size="sm" onClick={onToLatest}>
            К последнему
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-3 p-7"
      style={{
        background: "var(--glass-surface)",
        border: "1px solid var(--glass-border)",
        borderRadius: 24,
      }}
    >
      <h2 className="text-lg font-semibold" style={{ color: CHART.text }}>
        Кора ещё собирает первый отчёт
      </h2>
      <p className="text-sm" style={{ color: CHART.dim }}>
        Кора готовит {SURFACE_BREAKDOWN[surface]} из встреч, чатов и решений —
        он появится здесь, как только наберётся достаточно данных. Можно
        запустить сборку вручную.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRegenerate}
        disabled={isRegenerating}
        className="gap-1.5"
      >
        <RotateCw
          size={14}
          aria-hidden
          className={isRegenerating ? "animate-spin" : undefined}
        />
        Пересобрать
      </Button>
    </div>
  );
}
