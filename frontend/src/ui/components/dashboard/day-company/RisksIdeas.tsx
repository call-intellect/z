"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Lightbulb, Sparkles } from "lucide-react";

import type {
  InsightListItemApi,
  InsightDynamicApi,
  InsightSeverityApi,
} from "@/api/insights.api";
import type { IdeaListItemApi } from "@/api/ideas.api";
import { CHART, GRAD, glass } from "@/ui/components/dashboard/modern";
import { CardTitle } from "@/ui/components/dashboard/modern";
import { Chip } from "@/ui/components/dashboard/registry/_kit";

const ICON_ON_GRADIENT = "oklch(0.99 0.005 280)";

const DYNAMIC_LABEL: Record<InsightDynamicApi, string> = {
  spike: "всплеск",
  growing: "растёт",
  stable: "стабильно",
  declining: "снижается",
};

const DYNAMIC_TONE: Record<InsightDynamicApi, "ok" | "warn" | "risk" | "neutral"> = {
  spike: "risk",
  growing: "warn",
  stable: "neutral",
  declining: "ok",
};

function severityLed(severity: InsightSeverityApi): string {
  if (severity === "critical" || severity === "high") return CHART.red;
  if (severity === "medium") return CHART.amber;
  return CHART.faint;
}

function ideaBadge(idea: IdeaListItemApi): {
  label: string;
  tone: "ok" | "warn" | "risk" | "neutral";
} {
  if (idea.supporterCount > 1)
    return { label: `поддержали ${idea.supporterCount}`, tone: "ok" };
  if (idea.clusterId) return { label: "кластер", tone: "neutral" };
  return { label: "ново", tone: "neutral" };
}

function AiSummary({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-2 flex items-start gap-2.5 rounded-xl p-3 text-[12.5px] leading-snug"
      style={{
        background:
          "radial-gradient(120% 120% at 0 0, oklch(0.40 0.18 295 / 0.22), transparent 70%)",
        border: "1px solid oklch(0.66 0.2 300 / 0.2)",
        color: CHART.dim,
      }}
    >
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
        style={{ background: GRAD.violet, color: ICON_ON_GRADIENT }}
        aria-hidden
      >
        <Sparkles size={13} />
      </span>
      <div>
        <b style={{ color: CHART.text, fontWeight: 600 }}>Резюме за день:</b>{" "}
        {children}
      </div>
    </div>
  );
}

export function RisksIdeas({
  insights,
  ideas,
  risksSummary,
  ideasSummary,
}: {
  insights: InsightListItemApi[];
  ideas: IdeaListItemApi[];
  risksSummary: string | null;
  ideasSummary: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div style={glass()} className="p-6">
        <div className="flex items-center gap-3">
          <CardTitle icon={<AlertTriangle size={17} />} grad={GRAD.amber}>
            Что мешает / риски
          </CardTitle>
          <Link
            href="/insights"
            className="ml-auto text-xs font-medium"
            style={{ color: CHART.dim }}
          >
            Радар →
          </Link>
        </div>

        {risksSummary ? <div className="mt-4"><AiSummary>{risksSummary}</AiSummary></div> : <div className="mt-4" />}

        {insights.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Открытых рисков за день не зафиксировано.
          </p>
        ) : (
          <div className="flex flex-col">
            {insights.map((it) => (
              <Link
                key={it.id}
                href="/insights"
                className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: severityLed(it.severity),
                    boxShadow: `0 0 8px ${severityLed(it.severity)}`,
                  }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[13.5px] font-medium"
                    style={{ color: CHART.text }}
                  >
                    {it.statement}
                  </span>
                </span>
                <Chip tone={DYNAMIC_TONE[it.dynamicLabel]}>
                  {DYNAMIC_LABEL[it.dynamicLabel]}
                </Chip>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div style={glass()} className="p-6">
        <div className="flex items-center gap-3">
          <CardTitle icon={<Lightbulb size={17} />} grad={GRAD.teal}>
            Идеи
          </CardTitle>
          <Link
            href="/ideas"
            className="ml-auto text-xs font-medium"
            style={{ color: CHART.dim }}
          >
            Все идеи →
          </Link>
        </div>

        {ideasSummary ? <div className="mt-4"><AiSummary>{ideasSummary}</AiSummary></div> : <div className="mt-4" />}

        {ideas.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            Новых идей за день не собрано.
          </p>
        ) : (
          <div className="flex flex-col">
            {ideas.map((idea) => {
              const badge = ideaBadge(idea);
              return (
                <Link
                  key={idea.id}
                  href="/ideas"
                  className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: CHART.mint,
                      boxShadow: `0 0 8px ${CHART.mint}`,
                    }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[13.5px] font-medium"
                      style={{ color: CHART.text }}
                    >
                      {idea.statement}
                    </span>
                  </span>
                  <Chip tone={badge.tone}>{badge.label}</Chip>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
