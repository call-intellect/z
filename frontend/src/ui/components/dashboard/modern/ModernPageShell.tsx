"use client";

import type { ReactNode } from "react";

import { CHART, MODERN_PAGE_BG } from "./tokens";

export function ModernPageShell({
  title,
  subtitle,
  headerRight,
  maxWidth = "max-w-6xl",
  children,
}: {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  maxWidth?: "max-w-4xl" | "max-w-6xl";
  children: ReactNode;
}) {
  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: "100vh" }}>
      <div className={`mx-auto w-full ${maxWidth} px-4 py-6 md:px-6 md:py-8`}>
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: CHART.text }}
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}
