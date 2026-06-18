"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";

export type AdminBreadcrumbItem = {
  label: string;
  href?: string;
};

type Props = {
  items: AdminBreadcrumbItem[];
  className?: string;
};

export function AdminBreadcrumbs({ items, className }: Props) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Хлебные крошки"
      className={cn(
        "flex flex-wrap items-center gap-1 text-xs text-fg-tertiary",
        className,
      )}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const showSeparator = idx < items.length - 1;
        return (
          <span
            key={`${item.label}-${idx}`}
            className="inline-flex items-center gap-1"
          >
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="rounded-sm px-1 py-0.5 transition-colors hover:bg-bg-overlay hover:text-fg-primary"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={cn(
                  "px-1 py-0.5",
                  isLast && "font-medium text-fg-secondary",
                )}
              >
                {item.label}
              </span>
            )}
            {showSeparator ? (
              <ChevronRight
                size={12}
                className="text-fg-tertiary/60"
                aria-hidden
              />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
