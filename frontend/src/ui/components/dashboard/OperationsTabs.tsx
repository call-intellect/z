"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Newspaper, type LucideIcon } from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";

type TabItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const ITEMS: readonly TabItem[] = [
  { href: "/dashboard/operations", label: "Обзор", icon: Activity },
  { href: "/dashboard/operations/daily", label: "Сегодня", icon: Newspaper },
  { href: "/dashboard/operations/weekly", label: "Неделя", icon: BarChart3 },
];

export function OperationsTabs() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Разделы операционного дашборда"
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      {ITEMS.map((item) => {
        const isRoot = item.href === "/dashboard/operations";
        const isActive = isRoot
          ? pathname === item.href || pathname === `${item.href}/`
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-accent/15 text-accent-fg"
                : "bg-bg-overlay/60 text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary",
            )}
          >
            <Icon size={14} strokeWidth={1.75} className="shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
