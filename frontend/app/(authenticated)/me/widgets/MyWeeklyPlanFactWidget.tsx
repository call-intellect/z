"use client";

import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  HelpCircle,
  Minus,
} from "lucide-react";
import useSWR from "swr";

import { meDailyValueApi } from "@/api/me-daily-value.api";
import { mapMyWeeklySelf } from "@/domain/me-daily-value";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

export function MyWeeklyPlanFactWidget() {
  const weekStart = currentWeekMonday();
  const swr = useSWR(
    ["me-weekly-per-person", weekStart],
    async () =>
      mapMyWeeklySelf(await meDailyValueApi.weeklyPerPerson(weekStart)),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const data = swr.data;
  const row = data?.row ?? null;

  return (
    <GlassCard>
      <CardTitle icon={<CalendarCheck size={16} />} grad={GRAD.violet}>
        Мой план-факт за неделю
      </CardTitle>

      <div className="mt-4">
        {swr.isLoading ? (
          <div className="space-y-3">
            <div
              className="h-16 animate-pulse rounded-2xl"
              style={{ background: "var(--surface-inset)" }}
            />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-2xl"
                  style={{ background: "var(--surface-inset)" }}
                />
              ))}
            </div>
          </div>
        ) : !row ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            За эту неделю данных по вам пока нет.
          </p>
        ) : (
          <>
            <div
              className="flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: "var(--surface-inset)" }}
            >
              <span className="text-sm" style={{ color: CHART.dim }}>
                Надёжность обещаний
              </span>
              <div className="flex items-center gap-2">
                <ReliabilityValue
                  percent={row.reliabilityPercent}
                  denominator={row.reliabilityDenominator}
                />
                <TeamArrow
                  mine={row.reliabilityPercent}
                  team={data?.teamAverageReliabilityPercent ?? null}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat
                icon={<CheckCircle2 size={16} />}
                tone={CHART.mint}
                value={row.tasksDone}
                label="задач закрыто"
              />
              <Stat
                icon={<ClipboardCheck size={16} />}
                tone={CHART.cyan}
                value={row.checkInsCompleted}
                label="чек-инов"
              />
              <Stat
                icon={<HelpCircle size={16} />}
                tone={CHART.amber}
                value={row.promisesNoAnswer}
                label="без ответа"
              />
            </div>
          </>
        )}
      </div>
    </GlassCard>
  );
}

function ReliabilityValue({
  percent,
  denominator,
}: {
  percent: number | null;
  denominator: number;
}) {
  if (percent !== null) {
    return (
      <span
        className="text-lg font-semibold tabular-nums"
        style={{ color: CHART.mint }}
      >
        {percent}%
      </span>
    );
  }
  if (denominator > 0) {
    return (
      <span className="text-sm" style={{ color: CHART.faint }}>
        мало данных
      </span>
    );
  }
  return (
    <span className="text-sm" style={{ color: CHART.faint }}>
      —
    </span>
  );
}

function TeamArrow({
  mine,
  team,
}: {
  mine: number | null;
  team: number | null;
}) {
  if (mine === null || team === null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: CHART.faint }}
        title="Недостаточно данных для сравнения с командой"
      >
        <Minus size={12} />
      </span>
    );
  }
  const up = mine >= team;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: up ? CHART.mint : CHART.amber,
        background: up
          ? "oklch(0.85 0.15 165 / 0.12)"
          : "oklch(0.84 0.16 80 / 0.12)",
      }}
      title={`Среднее по команде: ${team}%`}
    >
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      команда {team}%
    </span>
  );
}

function Stat({
  icon,
  tone,
  value,
  label,
}: {
  icon: ReactNode;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: "var(--surface-inset)" }}
    >
      <div
        className="grid h-8 w-8 place-items-center rounded-lg"
        style={{ background: "var(--surface-inset)", color: tone }}
      >
        {icon}
      </div>
      <div
        className="mt-2 text-2xl font-semibold leading-none tabular-nums"
        style={{ color: CHART.text }}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px]" style={{ color: CHART.dim }}>
        {label}
      </div>
    </div>
  );
}

function currentWeekMonday(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : -(dow - 1);
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const day = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
