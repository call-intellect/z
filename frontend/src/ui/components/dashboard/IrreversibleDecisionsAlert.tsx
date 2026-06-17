"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { PulsePatternIrreversibleDecisionDomain } from "@/domain/pulse-patterns";

type Props = {
  decisions: PulsePatternIrreversibleDecisionDomain[];
  alertCount: number;
};

export function IrreversibleDecisionsAlert({ decisions, alertCount }: Props) {
  if (alertCount === 0) return null;

  const flagged = decisions.filter((d) => !d.hasAlternatives);
  if (flagged.length === 0) return null;

  return (
    <div
      className="mb-6 overflow-hidden rounded-xl border-l-4 border-chip-danger-fg/60 bg-gradient-to-r from-chip-danger-bg/25 via-chip-warning-bg/12 to-transparent p-5 shadow-card-soft"
      role="alert"
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-chip-danger-bg/20 p-2 text-chip-danger-fg"
          aria-hidden="true"
        >
          <AlertTriangle size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-chip-danger-fg">
            {alertCount} необратимых{" "}
            {alertCount === 1
              ? "решение"
              : alertCount < 5
                ? "решения"
                : "решений"}{" "}
            без рассмотренных альтернатив
          </div>
          <p className="mt-1 text-xs text-fg-secondary">
            Type-1 (двери в одну сторону) — стоит зафиксировать альтернативы,
            чтобы решение можно было защитить позже.
          </p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {flagged.slice(0, 5).map((d) => (
          <li key={d.decisionId}>
            <Link
              href={`/decisions/${encodeURIComponent(d.decisionId)}`}
              className="block rounded-md bg-bg-card/60 p-2 text-sm transition-colors hover:bg-bg-card"
            >
              <p className="line-clamp-2 text-fg-primary">
                {d.statement || "Без формулировки"}
              </p>
              <p className="mt-0.5 text-xs text-fg-tertiary">
                {d.decidedAt.toLocaleDateString("ru", {
                  day: "2-digit",
                  month: "short",
                })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
