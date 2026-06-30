"use client";

import { CheckCircle2 } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import {
  CHART,
  glass,
  ModernPageShell,
} from "@/ui/components/dashboard/modern";
import { DashboardCanvas } from "@/ui/components/dashboard/registry/DashboardCanvas";
import { toDashboardRole } from "@/ui/components/dashboard/registry/presets";

function defaultLastMondayUtc(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -13 : -(dow - 1) - 7;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function WeekDesktopClient() {
  const { currentOrgRole } = useAuth();
  const role = toDashboardRole(currentOrgRole);

  return (
    <ModernPageShell
      title="Неделя"
      subtitle="Понедельничный разбор: куда идём и лучше ли стало."
    >
      <div className="space-y-6">
        <WeekVerdictBar weekStart={defaultLastMondayUtc()} />
        <DashboardCanvas role={role} rhythm="week" />
      </div>
    </ModernPageShell>
  );
}

function WeekVerdictBar({ weekStart }: { weekStart: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl p-4"
      style={glass({ borderRadius: 16 })}
      role="status"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
        style={{ background: "oklch(0.85 0.15 165 / 0.14)", color: CHART.mint }}
        aria-hidden
      >
        <CheckCircle2 size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold" style={{ color: CHART.text }}>
          Понедельничный разбор недели
        </div>
        <div className="mt-0.5 truncate text-xs" style={{ color: CHART.faint }}>
          Неделя с {formatRu(weekStart)} · температура и движение целей — ниже.
        </div>
      </div>
    </div>
  );
}

function formatRu(dateLocal: string): string {
  const [y, m, d] = dateLocal.split("-");
  return `${d}.${m}.${y}`;
}
