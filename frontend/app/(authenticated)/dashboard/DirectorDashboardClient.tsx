"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Calendar, Sparkles } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { CHART, MODERN_PAGE_BG } from "@/ui/components/dashboard/modern";
import { DashboardCanvas } from "@/ui/components/dashboard/registry/DashboardCanvas";
import { DayCompanyHero } from "@/ui/components/dashboard/day-company/DayCompanyHero";
import { toDashboardRole } from "@/ui/components/dashboard/registry/presets";

export function DirectorDashboardClient() {
  const { user, currentOrgRole } = useAuth();

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
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/week"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: "var(--surface-inset)", color: CHART.dim }}
              aria-label="Открыть Неделю"
            >
              <Calendar size={14} strokeWidth={1.75} className="shrink-0" />
              <span>Неделя</span>
            </Link>
            <Link
              href="/month"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: "var(--surface-inset)", color: CHART.dim }}
              aria-label="Открыть Итоги месяца"
            >
              <Sparkles size={14} strokeWidth={1.75} className="shrink-0" />
              <span>Итоги месяца</span>
            </Link>
          </div>
        </header>

        {currentOrgRole === "owner" ? <DayCompanyHero /> : null}

        <DashboardCanvas role={role} rhythm="today" />
      </div>
    </div>
  );
}
