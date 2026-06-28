"use client";

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import type { DailyDigestLetterSectionApi } from "@/api/operations-daily-digest.api";
import { CHART, GRAD } from "@/ui/components/dashboard/modern";
import { cn } from "@/ui/shadcn/lib/utils";

const ICON_ON_GRADIENT = "oklch(0.99 0.005 280)";

export function DayLetter({
  sections,
  fallbackProse,
}: {
  sections: DailyDigestLetterSectionApi[] | null;
  fallbackProse: string | null;
}) {
  const [open, setOpen] = useState(false);

  const hasContent =
    (sections && sections.length > 0) ||
    (fallbackProse && fallbackProse.trim().length > 0);
  if (!hasContent) return null;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl p-4 text-[14.5px] font-semibold transition-colors"
        style={
          open
            ? {
                background: "var(--surface-inset)",
                border: "1px solid var(--glass-border)",
                color: CHART.dim,
              }
            : { background: GRAD.violet, color: CHART.text }
        }
      >
        {open ? "Свернуть отчёт" : "Читать полный отчёт за день"}
        <ChevronDown
          size={18}
          aria-hidden
          className={cn("transition-transform", open ? "rotate-180" : "")}
        />
      </button>

      {open ? (
        <article
          className="mt-4 p-8"
          style={{
            background: "var(--glass-surface)",
            border: "1px solid var(--glass-border)",
            borderRadius: 24,
            boxShadow: "var(--glass-shadow)",
            backdropFilter: "var(--glass-blur)",
            WebkitBackdropFilter: "var(--glass-blur)",
          }}
        >
          {sections && sections.length > 0 ? (
            <div className="flex flex-col">
              {sections.map((section, idx) => (
                <section
                  key={section.key || `${idx}`}
                  className={cn(
                    "py-6",
                    idx > 0 ? "border-t" : "",
                  )}
                  style={
                    idx > 0
                      ? { borderColor: "var(--glass-border)" }
                      : undefined
                  }
                >
                  <div className="mb-3.5 flex items-center gap-3">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                      style={{ background: GRAD.violet, color: ICON_ON_GRADIENT }}
                      aria-hidden
                    >
                      <Sparkles size={15} />
                    </span>
                    <h4
                      className="text-base font-bold tracking-tight"
                      style={{ color: CHART.text }}
                    >
                      {section.title}
                    </h4>
                  </div>
                  <p
                    className="whitespace-pre-line text-[14.5px] leading-relaxed"
                    style={{ color: CHART.dim }}
                  >
                    {section.prose}
                  </p>
                  {section.cites && section.cites.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {section.cites.map((cite, ci) => (
                        <span
                          key={`${cite.ref}-${ci}`}
                          className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            background: "var(--surface-inset-strong)",
                            color: CHART.cyan,
                          }}
                        >
                          {cite.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <p
              className="whitespace-pre-line text-[14.5px] leading-relaxed"
              style={{ color: CHART.dim }}
            >
              {fallbackProse}
            </p>
          )}
        </article>
      ) : null}
    </div>
  );
}
