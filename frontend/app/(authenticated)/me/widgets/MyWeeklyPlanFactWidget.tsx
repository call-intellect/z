"use client";

import type { ReactNode } from "react";
import { CalendarCheck, CheckCircle2, ClipboardCheck } from "lucide-react";
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
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl"
                style={{ background: "var(--surface-inset)" }}
              />
            ))}
          </div>
        ) : !row ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            За эту неделю данных по вам пока нет.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
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
          </div>
        )}
      </div>
    </GlassCard>
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
