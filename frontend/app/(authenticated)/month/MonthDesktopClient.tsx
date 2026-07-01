"use client";

import { useAuth } from "@/contexts/auth-context";
import { ModernPageShell } from "@/ui/components/dashboard/modern";
import { MonthCompanyHero } from "@/ui/components/dashboard/month-company/MonthCompanyHero";
import { DashboardCanvas } from "@/ui/components/dashboard/registry/DashboardCanvas";
import { toDashboardRole } from "@/ui/components/dashboard/registry/presets";

export function MonthDesktopClient() {
  const { currentOrgRole } = useAuth();
  const role = toDashboardRole(currentOrgRole);

  return (
    <ModernPageShell
      title="Итоги месяца"
      subtitle="Достижения, зрелость, незаменимость и динамика команды за месяц."
    >
      {currentOrgRole === "owner" ? <MonthCompanyHero /> : null}
      {currentOrgRole !== "owner" ? (
        <DashboardCanvas role={role} rhythm="month" />
      ) : null}
    </ModernPageShell>
  );
}
