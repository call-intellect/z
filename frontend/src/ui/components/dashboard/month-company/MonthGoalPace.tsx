"use client";

import type { MonthlyDigestPaceApi } from "@/api/monthly-digest.api";
import { CHART } from "@/ui/components/dashboard/modern";

const MONTH_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

function formatEtaIso(etaIso: string | null): string {
  if (!etaIso) return "—";
  const parsed = new Date(etaIso);
  if (Number.isNaN(parsed.getTime())) return "—";
  const day = parsed.getUTCDate();
  const month = MONTH_GENITIVE[parsed.getUTCMonth()];
  const year = parsed.getUTCFullYear();
  if (!month) return "—";
  return `${day} ${month} ${year}`;
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, value));
}

function ProgressLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: string;
}) {
  const pct = clampPercent(value);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold" style={{ color: CHART.dim }}>
          {label}
        </span>
        <span
          className="text-[12px] font-bold tabular-nums"
          style={{ color: CHART.text }}
        >
          {pct === null ? "—" : `${Math.round(pct)}/100`}
        </span>
      </div>
      <span
        className="mt-1.5 block h-2 overflow-hidden rounded-full"
        style={{ background: "var(--surface-inset-strong)" }}
        aria-hidden
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct ?? 0}%`, background: tone }}
        />
      </span>
    </div>
  );
}

export function MonthGoalPace({ pace }: { pace: MonthlyDigestPaceApi }) {
  const allEmpty =
    pace.factToGoal === null &&
    pace.planToGoal === null &&
    pace.etaIso === null &&
    !pace.leadingSignal;

  if (allEmpty) {
    return (
      <p className="text-[13px]" style={{ color: CHART.faint }}>
        Темп пока не рассчитан.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ProgressLine label="Факт" value={pace.factToGoal} tone={CHART.mint} />
        <ProgressLine label="План" value={pace.planToGoal} tone={CHART.amber} />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <div
            className="text-[10.5px] font-bold uppercase tracking-[0.06em]"
            style={{ color: CHART.faint }}
          >
            Прогноз достижения
          </div>
          <div
            className="mt-0.5 text-[14px] font-bold"
            style={{ color: CHART.text }}
          >
            {formatEtaIso(pace.etaIso)}
          </div>
        </div>
        {pace.leadingSignal ? (
          <div className="min-w-0">
            <div
              className="text-[10.5px] font-bold uppercase tracking-[0.06em]"
              style={{ color: CHART.faint }}
            >
              Ведущий сигнал
            </div>
            <div
              className="mt-0.5 text-[13px] leading-snug"
              style={{ color: CHART.dim }}
            >
              {pace.leadingSignal}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
