"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  CalendarDays,
  HeartHandshake,
  Home,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";

type SubpageItem = {
  segment: string;
  label: string;
  icon: LucideIcon;
};

const ITEMS: readonly SubpageItem[] = [
  { segment: "", label: "Обзор", icon: Home },
  { segment: "knowledge-profile", label: "Знания", icon: BookOpen },
  { segment: "skill-profile", label: "Навыки", icon: Sparkles },
  { segment: "appointments", label: "Встречи", icon: CalendarDays },
  { segment: "contributions", label: "Вклад", icon: TrendingUp },
  {
    segment: "social-contribution",
    label: "Командный вклад",
    icon: HeartHandshake,
  },
  { segment: "pulse", label: "Пульс", icon: Activity },
];

export function PersonSubpagesNav({ entityId }: { entityId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/persons/${encodeURIComponent(entityId)}`;

  return (
    <nav
      aria-label="Разделы профиля сотрудника"
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      {ITEMS.map((item) => {
        const href = item.segment ? `${base}/${item.segment}` : base;
        const isActive = item.segment
          ? pathname === href || pathname.startsWith(`${href}/`)
          : pathname === base || pathname === `${base}/`;
        const Icon = item.icon;

        return (
          <Link
            key={item.segment || "root"}
            href={href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-accent/15 text-accent-fg"
                : "bg-bg-overlay/60 text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={14} strokeWidth={1.75} className="shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
