"use client";

import {
  Brain,
  LayoutDashboard,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";

export type DashboardTabId = "overview" | "team" | "knowledge" | "goals";

export type DashboardTabsProps = {
  activeTab: DashboardTabId;
  onChange: (id: DashboardTabId) => void;
};

const TABS: ReadonlyArray<{
  id: DashboardTabId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "team", label: "Команда", icon: Users },
  { id: "knowledge", label: "Знания", icon: Brain },
  { id: "goals", label: "Цели и встречи", icon: Target },
];

export function DashboardTabs({ activeTab, onChange }: DashboardTabsProps) {
  return (
    <nav
      aria-label="Разделы главной страницы"
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              isActive
                ? "bg-accent/15 text-accent-fg"
                : "bg-bg-overlay/60 text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={14} strokeWidth={1.75} className="shrink-0" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
