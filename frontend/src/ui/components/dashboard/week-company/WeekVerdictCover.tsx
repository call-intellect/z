"use client";

import { RotateCw, Volume2 } from "lucide-react";

import type {
  WeeklyDayTrendAxisApi,
  WeeklyDayTrendStateApi,
  WeeklyDigestVerdictApi,
  WeeklyDigestVerdictAxisApi,
} from "@/api/weekly-digest.api";
import { CHART, STATUS_TONE } from "@/ui/components/dashboard/modern";
import { Button } from "@/ui/shadcn/button";

const AXIS_NAME: Record<WeeklyDigestVerdictAxisApi["key"], string> = {
  team: "Команда",
  clients: "Клиенты",
  execution: "Исполнение",
  overall: "Общий",
};

const AXIS_ORDER: WeeklyDigestVerdictAxisApi["key"][] = [
  "team",
  "clients",
  "execution",
  "overall",
];

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

const TREND_STATE_COLOR: Record<WeeklyDayTrendStateApi, string | null> = {
  ok: CHART.mint,
  warn: CHART.amber,
  risk: CHART.red,
  none: null,
};

function axisTone(state: WeeklyDigestVerdictAxisApi["state"]): {
  c: string;
  bg: string;
} {
  if (state === "ok") return STATUS_TONE.ok;
  if (state === "risk") return STATUS_TONE.risk;
  return STATUS_TONE.warning;
}

function dayLabel(dateLocal: string): string {
  const d = new Date(`${dateLocal}T00:00:00Z`);
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`;
}

const COVER_BG =
  "radial-gradient(150% 120% at 0% 0%, oklch(0.42 0.16 60 / 0.40), transparent 55%), var(--glass-surface)";

function DayTrend({ dayTrend }: { dayTrend: WeeklyDayTrendAxisApi[] }) {
  const byKey = new Map(dayTrend.map((axis) => [axis.key, axis]));
  const headDays = dayTrend.find((axis) => axis.days.length > 0)?.days ?? [];

  if (headDays.length === 0) return null;

  return (
    <div
      className="mt-6 pt-5"
      style={{ borderTop: "1px solid var(--glass-border)" }}
    >
      <div
        className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.06em]"
        style={{ color: CHART.faint }}
      >
        Тренд по дням
      </div>
      <div className="flex flex-col gap-2.5">
        <div
          className="grid items-center gap-x-2.5"
          style={{
            gridTemplateColumns: `104px repeat(${headDays.length}, minmax(0, 1fr))`,
          }}
        >
          <span />
          {headDays.map((day) => (
            <span
              key={day.dateLocal}
              className="text-center text-[11px] font-semibold"
              style={{ color: CHART.faint }}
            >
              {dayLabel(day.dateLocal)}
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
                gridTemplateColumns: `104px repeat(${headDays.length}, minmax(0, 1fr))`,
              }}
            >
              <span
                className="text-[12px] font-semibold"
                style={{ color: CHART.dim }}
              >
                {AXIS_NAME[key]}
              </span>
              {axis.days.map((day) => {
                const color = TREND_STATE_COLOR[day.state];
                return (
                  <span key={day.dateLocal} className="flex justify-center">
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

export function WeekVerdictCover({
  emoji,
  title,
  oneLiner,
  meta,
  axes,
  dayTrend,
  onRegenerate,
  isRegenerating,
}: {
  emoji: string | null;
  title: string;
  oneLiner: string;
  meta: string | null;
  axes: WeeklyDigestVerdictApi["axes"] | null;
  dayTrend: WeeklyDayTrendAxisApi[] | null;
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  const orderedAxes = axes
    ? [...axes].sort(
        (a, b) => AXIS_ORDER.indexOf(a.key) - AXIS_ORDER.indexOf(b.key),
      )
    : [];

  const hasTrend = !!dayTrend && dayTrend.some((axis) => axis.days.length > 0);

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

      {hasTrend ? <DayTrend dayTrend={dayTrend!} /> : null}

      {meta ? (
        <div className="mt-4 text-[11.5px]" style={{ color: CHART.faint }}>
          {meta}
        </div>
      ) : null}
    </section>
  );
}
