"use client";

import { RotateCw, Volume2 } from "lucide-react";

import type {
  MonthWeekTrendAxisApi,
  MonthWeekTrendStateApi,
  MonthlyDigestVerdictApi,
  MonthlyDigestVerdictAxisApi,
} from "@/api/monthly-digest.api";
import { CHART, STATUS_TONE } from "@/ui/components/dashboard/modern";
import { Button } from "@/ui/shadcn/button";

const AXIS_NAME: Record<MonthlyDigestVerdictAxisApi["key"], string> = {
  team: "Команда",
  clients: "Клиенты",
  execution: "Исполнение",
  overall: "Общий",
};

const AXIS_ORDER: MonthlyDigestVerdictAxisApi["key"][] = [
  "team",
  "clients",
  "execution",
  "overall",
];

const TREND_STATE_COLOR: Record<MonthWeekTrendStateApi, string | null> = {
  ok: CHART.mint,
  warn: CHART.amber,
  risk: CHART.red,
  none: null,
};

function axisTone(state: MonthlyDigestVerdictAxisApi["state"]): {
  c: string;
  bg: string;
} {
  if (state === "ok") return STATUS_TONE.ok;
  if (state === "risk") return STATUS_TONE.risk;
  return STATUS_TONE.warning;
}

const COVER_BG =
  "radial-gradient(150% 120% at 0% 0%, oklch(0.42 0.16 60 / 0.40), transparent 55%), var(--glass-surface)";

function WeekTrend({ weekTrend }: { weekTrend: MonthWeekTrendAxisApi[] }) {
  const byKey = new Map(weekTrend.map((axis) => [axis.key, axis]));
  const headWeeks =
    weekTrend.find((axis) => axis.weeks.length > 0)?.weeks ?? [];

  if (headWeeks.length === 0) return null;

  return (
    <div
      className="mt-6 pt-5"
      style={{ borderTop: "1px solid var(--glass-border)" }}
    >
      <div
        className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.06em]"
        style={{ color: CHART.faint }}
      >
        Как изменились оси по неделям
      </div>
      <div className="flex flex-col gap-2.5">
        <div
          className="grid items-center gap-x-2.5"
          style={{
            gridTemplateColumns: `104px repeat(${headWeeks.length}, minmax(0, 1fr))`,
          }}
        >
          <span />
          {headWeeks.map((week, index) => (
            <span
              key={week.weekStart}
              className="text-center text-[11px] font-semibold"
              style={{ color: CHART.faint }}
            >
              {`Нед ${index + 1}`}
            </span>
          ))}
        </div>
        {AXIS_ORDER.map((key) => {
          const axis = byKey.get(key);
          if (!axis) return null;
          return (
            <div
              key={key}
              className="grid items-center gap-x-2.5"
              style={{
                gridTemplateColumns: `104px repeat(${headWeeks.length}, minmax(0, 1fr))`,
              }}
            >
              <span
                className="text-[12px] font-semibold"
                style={{ color: CHART.dim }}
              >
                {AXIS_NAME[key]}
              </span>
              {axis.weeks.map((week) => {
                const color = TREND_STATE_COLOR[week.state];
                return (
                  <span key={week.weekStart} className="flex justify-center">
                    <span
                      className="h-4 w-full max-w-[42px] rounded-md"
                      style={
                        color
                          ? {
                              background: color,
                              opacity: 0.32,
                              boxShadow: `inset 0 0 0 1px ${color}`,
                            }
                          : { background: "var(--surface-inset)" }
                      }
                      aria-hidden
                    />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MonthVerdictCover({
  emoji,
  title,
  oneLiner,
  meta,
  axes,
  weekTrend,
  onRegenerate,
  isRegenerating,
}: {
  emoji: string | null;
  title: string;
  oneLiner: string;
  meta: string | null;
  axes: MonthlyDigestVerdictApi["axes"] | null;
  weekTrend: MonthWeekTrendAxisApi[] | null;
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  const orderedAxes = axes
    ? [...axes].sort(
        (a, b) => AXIS_ORDER.indexOf(a.key) - AXIS_ORDER.indexOf(b.key),
      )
    : [];

  const hasTrend =
    !!weekTrend && weekTrend.some((axis) => axis.weeks.length > 0);

  return (
    <section
      className="relative overflow-hidden p-7"
      style={{
        background: COVER_BG,
        border: "1px solid var(--glass-border)",
        borderRadius: 24,
        boxShadow: "var(--glass-shadow)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
      }}
    >
      <div className="flex items-start gap-4">
        {emoji ? (
          <span className="text-[42px] leading-none" aria-hidden>
            {emoji}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2
            className="text-[26px] font-bold tracking-tight"
            style={{ color: CHART.text }}
          >
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled
            title="Скоро: озвучка отчёта"
            className="gap-1.5"
          >
            <Volume2 size={14} aria-hidden />
            Озвучить
          </Button>
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
      </div>

      <p
        className="mt-4 max-w-[820px] text-base leading-relaxed"
        style={{ color: CHART.text }}
      >
        {oneLiner}
      </p>

      {orderedAxes.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {orderedAxes.map((axis) => {
            const tone = axisTone(axis.state);
            return (
              <div
                key={axis.key}
                className="flex flex-col gap-1.5 rounded-2xl p-4"
                style={{
                  background: "var(--surface-inset)",
                  border: "1px solid var(--glass-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: tone.c,
                      boxShadow: `0 0 12px ${tone.c}`,
                    }}
                    aria-hidden
                  />
                  <span
                    className="text-[12.5px] font-semibold"
                    style={{ color: CHART.dim }}
                  >
                    {AXIS_NAME[axis.key]}
                  </span>
                </div>
                <div
                  className="text-[15px] font-bold tracking-tight"
                  style={{ color: CHART.text }}
                >
                  {axis.label}
                </div>
                <div
                  className="text-[11.5px] leading-snug"
                  style={{ color: CHART.faint }}
                >
                  {axis.why}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {hasTrend ? <WeekTrend weekTrend={weekTrend!} /> : null}

      {meta ? (
        <div className="mt-4 text-[11.5px]" style={{ color: CHART.faint }}>
          {meta}
        </div>
      ) : null}
    </section>
  );
}
