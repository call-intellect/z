"use client";

import { type ReactNode } from "react";

import { cn } from "@/ui/shadcn/lib/utils";
import { AdminBreadcrumbs, type AdminBreadcrumbItem } from "./AdminBreadcrumbs";

type Props = {
  breadcrumbs?: AdminBreadcrumbItem[];
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function AdminSection({
  breadcrumbs,
  title,
  description,
  actions,
  children,
  className,
}: Props) {
  return (
    <section className={cn("flex flex-col gap-5", className)}>
      <header className="flex flex-col gap-3">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <AdminBreadcrumbs items={breadcrumbs} />
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-fg-primary sm:text-2xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-prose text-sm text-fg-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
