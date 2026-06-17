"use client";

import { TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

import { monthLabel, type MonthlyPointDomain } from "@/domain/referral";
import {
  CardTitle,
  CHART,
  ChartTip,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

interface Props {
  points: MonthlyPointDomain[];
}

type Mode = "monthly" | "cumulative";

export function IncomeChart({ points }: Props) {
  const [mode, setMode] = useState<Mode>("monthly");

  const monthly = useMemo(
    () =>
      points.map((p) => ({
        month: p.month,
        label: monthLabel(p.month),
        income: p.incomeRub,
        active: p.activeClients,
      })),
    [points],
  );

  const cumulative = useMemo(() => {
    let acc = 0;
    return monthly.map((p) => {
      acc += p.income;
      return { ...p, income: acc };
    });
  }, [monthly]);

  const data = mode === "monthly" ? monthly : cumulative;

  const totalEarned = useMemo(
    () => monthly.reduce((sum, p) => sum + p.income, 0),
    [monthly],
  );
  const last = monthly.at(-1)?.income ?? 0;
  const prev = monthly.at(-2)?.income ?? 0;
  const delta = last - prev;

  const fmt = (v: number) => `${v.toLocaleString("ru-RU")} ₽`;

  return (
    <GlassCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle
            icon={<TrendingUp className="h-4 w-4" />}
            grad={GRAD.violet}
          >
            Доход за 12 месяцев
          </CardTitle>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-[32px] font-semibold leading-none tracking-tight text-fg-primary">
              {fmt(totalEarned)}
            </span>
            {delta !== 0 && (
              <span
                className="pb-1 text-sm"
                style={{
                  color:
                    delta > 0
                      ? "var(--chip-success-fg)"
                      : "var(--chip-danger-fg)",
                }}
              >
                {delta > 0 ? "+" : "−"}
                {Math.abs(delta).toLocaleString("ru-RU")} ₽ за месяц
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-tertiary">
            {mode === "monthly"
              ? "Сколько заработал в каждом месяце."
              : "Накопленный доход нарастающим итогом."}
          </p>
        </div>

        {}
        <div
          className="flex shrink-0 rounded-xl p-1"
          style={{ background: "var(--surface-inset)" }}
          role="tablist"
          aria-label="Режим графика дохода"
        >
          <ModeTab
            active={mode === "monthly"}
            onClick={() => setMode("monthly")}
          >
            По месяцам
          </ModeTab>
          <ModeTab
            active={mode === "cumulative"}
            onClick={() => setMode("cumulative")}
          >
            Накопительно
          </ModeTab>
        </div>
      </div>

      <div className="mt-4 h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {mode === "monthly" ? (
            <BarChart
              data={data}
              margin={{ top: 10, right: 8, bottom: 0, left: -8 }}
            >
              <defs>
                <linearGradient
                  id="referral-income-bar"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={CHART.cyan} />
                  <stop
                    offset="100%"
                    stopColor={CHART.violet}
                    stopOpacity={0.7}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: CHART.faint, fontSize: 12 }}
              />
              <Tooltip
                content={<ChartTip />}
                cursor={{ fill: "var(--surface-inset)" }}
              />
              <Bar
                dataKey="income"
                name="Доход"
                radius={[8, 8, 0, 0]}
                fill="url(#referral-income-bar)"
                maxBarSize={34}
              />
            </BarChart>
          ) : (
            <AreaChart
              data={data}
              margin={{ top: 10, right: 8, bottom: 0, left: -8 }}
            >
              <defs>
                <linearGradient
                  id="referral-income-area"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={CHART.violet}
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="100%"
                    stopColor={CHART.violet}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: CHART.faint, fontSize: 12 }}
              />
              <Tooltip
                content={<ChartTip />}
                cursor={{ stroke: "var(--border-strong)" }}
              />
              <Area
                type="monotone"
                dataKey="income"
                name="Доход нарастающим итогом"
                stroke={CHART.violet}
                strokeWidth={2.5}
                fill="url(#referral-income-area)"
                dot={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
      style={
        active
          ? { background: GRAD.violet, color: "oklch(0.99 0.005 280)" }
          : { color: "var(--text-secondary)" }
      }
    >
      {children}
    </button>
  );
}
