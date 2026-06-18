"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Calendar } from "lucide-react";

export type TabEmptyStateProps = {
  tabLabel: string;
  icon?: LucideIcon;
  hint?: string;
  actionLabel?: string;
  actionHref?: string;
};

export function TabEmptyState({
  tabLabel,
  icon: Icon = Calendar,
  hint,
  actionLabel = "Создать встречу",
  actionHref = "/meetings/new",
}: TabEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border-subtle/60 bg-bg-card p-8 text-center">
      <Icon size={48} strokeWidth={1.25} className="text-fg-tertiary" />
      <h3 className="text-base font-semibold text-fg-primary">
        В разделе «{tabLabel}» пока нет данных
      </h3>
      <p className="max-w-md text-sm text-fg-secondary">
        {hint ??
          "Этот раздел заполнится после первой встречи с командой. Подключите календарь или проведите встречу через Кору."}
      </p>
      <Link
        href={actionHref}
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
