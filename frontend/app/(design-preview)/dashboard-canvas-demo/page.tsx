"use client";

import { DashboardCanvas } from "@/ui/components/dashboard/registry/DashboardCanvas";
import { ModernPageShell } from "@/ui/components/dashboard/modern";

export default function DashboardCanvasDemoPage() {
  return (
    <ModernPageShell
      title="Демонстрация модульного холста"
      subtitle="Роль: COO · Ритм: Сегодня"
    >
      <DashboardCanvas role="coo" rhythm="today" />
    </ModernPageShell>
  );
}
