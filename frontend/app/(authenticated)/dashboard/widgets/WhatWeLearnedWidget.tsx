"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrainCircuit } from "lucide-react";

import {
  signalTypeLabel,
  type DirectorDashboardSignalDomain,
  type DirectorDashboardThemeDomain,
} from "@/domain/director-dashboard";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

export type WhatWeLearnedDecision = {
  id: string;
  statement: string;
  decidedAt: Date;
};

export function WhatWeLearnedWidget({
  themes,
  signals,
  decisions,
}: {
  themes: DirectorDashboardThemeDomain[];
  signals: DirectorDashboardSignalDomain[];
  decisions: WhatWeLearnedDecision[];
}) {
  return (
    <GlassCard>
      <CardTitle icon={<BrainCircuit size={16} />} grad={GRAD.violet}>
        Что мы узнали
      </CardTitle>

      <div className="mt-4 space-y-5">
        {}
        <Section label="Темы">
          {themes.length === 0 ? (
            <Dash />
          ) : (
            <ul className="space-y-2">
              {themes.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span
                    className="line-clamp-1 text-sm"
                    style={{ color: CHART.text }}
                  >
                    {t.name}
                  </span>
                  <span
                    className="shrink-0 text-xs tabular-nums"
                    style={{ color: CHART.faint }}
                  >
                    {t.blocksCount} упом.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {}
        <Section label="Сигналы">
          {signals.length === 0 ? (
            <Dash />
          ) : (
            <ul className="space-y-2.5">
              {signals.map((s) => (
                <li key={s.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className="line-clamp-1 text-sm"
                      style={{ color: CHART.text }}
                    >
                      {s.name}
                    </span>
                    <span
                      className="shrink-0 text-xs"
                      style={{ color: CHART.faint }}
                    >
                      {signalTypeLabel(s.signalType)}
                    </span>
                  </div>
                  <Reason reasonSourceRef={s.reasonSourceRef} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {}
        <Section label="Решения">
          {decisions.length === 0 ? (
            <Dash />
          ) : (
            <ul className="space-y-2.5">
              {decisions.map((d) => (
                <li key={d.id}>
                  <span
                    className="line-clamp-2 text-sm"
                    style={{ color: CHART.text }}
                  >
                    {d.statement}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </GlassCard>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div
        className="mb-2 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: CHART.faint }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Reason({
  reasonSourceRef,
}: {
  reasonSourceRef: DirectorDashboardSignalDomain["reasonSourceRef"];
}) {
  if (!reasonSourceRef?.meetingId) return null;
  const title = reasonSourceRef.meetingTitle ?? "встреча";
  return (
    <Link
      href={`/meetings/${encodeURIComponent(reasonSourceRef.meetingId)}/result`}
      className="mt-0.5 inline-block text-xs hover:underline"
      style={{ color: CHART.cyan }}
      title="Открыть встречу-источник"
    >
      Причина: встреча «{title}»
    </Link>
  );
}

function Dash() {
  return (
    <span className="text-sm" style={{ color: CHART.faint }}>
      —
    </span>
  );
}
