"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { CHART, GRAD, MODERN_PAGE_BG } from "@/ui/components/dashboard/modern";
import { DashboardCanvas } from "@/ui/components/dashboard/registry/DashboardCanvas";
import { DayCompanyHero } from "@/ui/components/dashboard/day-company/DayCompanyHero";
import { WeekCompanyHero } from "@/ui/components/dashboard/week-company/WeekCompanyHero";
import { toDashboardRole } from "@/ui/components/dashboard/registry/presets";

export function DirectorDashboardClient() {
  const { user, currentOrgRole } = useAuth();
  const [rhythm, setRhythm] = useState<"day" | "week">(() =>
    new Date().getDay() === 1 ? "week" : "day",
  );

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("rhythm");
    if (q === "week" || q === "day") setRhythm(q);
  }, []);

  const greetingName = useMemo(() => {
    return user?.name?.trim() || user?.email?.split("@")[0] || "друг";
  }, [user]);

  const role = toDashboardRole(currentOrgRole);

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: "100vh" }}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: CHART.text }}
            >
              Сегодня — {greetingName}
            </h1>
            <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
              Что случилось, что буксует, куда движемся — за 30 секунд.
            </p>
          </div>
          <div
            className="inline-flex shrink-0 items-center gap-1 rounded-[13px] p-1"
            style={{
              background: "var(--surface-inset)",
              border: "1px solid var(--glass-border)",
            }}
            role="tablist"
            aria-label="Ритм отчёта"
          >
            <button
              type="button"
              role="tab"
              aria-selected={rhythm === "day"}
              onClick={() => setRhythm("day")}
              className="rounded-[9px] px-5 py-2 text-[13px] font-semibold transition-colors"
              style={
                rhythm === "day"
                  ? { background: GRAD.violet, color: CHART.text }
                  : { background: "transparent", color: CHART.dim }
              }
            >
              День
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rhythm === "week"}
              onClick={() => setRhythm("week")}
              className="rounded-[9px] px-5 py-2 text-[13px] font-semibold transition-colors"
              style={
                rhythm === "week"
                  ? { background: GRAD.violet, color: CHART.text }
                  : { background: "transparent", color: CHART.dim }
              }
            >
              Неделя
            </button>
            <Link
              href="/month"
              className="inline-flex items-center gap-1.5 rounded-[9px] px-5 py-2 text-[13px] font-semibold transition-colors"
              style={{ background: "transparent", color: CHART.dim }}
              aria-label="Открыть Итоги месяца"
            >
              <Sparkles size={14} strokeWidth={1.75} className="shrink-0" />
              <span>Месяц</span>
            </Link>
          </div>
        </header>

        {currentOrgRole === "owner" ? (
          rhythm === "week" ? (
            <WeekCompanyHero />
          ) : (
            <DayCompanyHero />
          )
        ) : null}

        {currentOrgRole === "owner" && rhythm === "day" ? null : (
          <DashboardCanvas
            role={role}
            rhythm={rhythm === "week" ? "week" : "today"}
          />
        )}
      </div>
    </div>
  );
}
