"use client";

import { useAuth } from "@/contexts/auth-context";
import { ModernPageShell } from "@/ui/components/dashboard/modern";
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
      <DashboardCanvas role={role} rhythm="month" />
    </ModernPageShell>
  );
}
