"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Lightbulb, Sparkles } from "lucide-react";

import type {
  InsightListItemApi,
  InsightDynamicApi,
  InsightSeverityApi,
  InsightCauseCategoryApi,
} from "@/api/insights.api";
import type { IdeaClusterApi } from "@/api/ideas.api";
import type { OperationsTeamFrictionApi } from "@/api/operations-dashboard.api";
import type { ProvenanceEntityTypeApi } from "@/api/provenance.api";
import { useAuth } from "@/contexts/auth-context";
import { CHART, GRAD, glass } from "@/ui/components/dashboard/modern";
import { CardTitle } from "@/ui/components/dashboard/modern";
import { Chip } from "@/ui/components/dashboard/registry/_kit";
import { ProvenanceDrawer } from "@/ui/components/provenance/ProvenanceDrawer";
import { pluralRu } from "@/domain/weekly-per-person";

const ICON_ON_GRADIENT = "oklch(0.99 0.005 280)";

const RED_GRADIENT =
  "linear-gradient(135deg, oklch(0.72 0.2 25), oklch(0.58 0.22 20))";

type ChipTone = "ok" | "warn" | "risk" | "neutral";

const CLUSTERS_VISIBLE = 4;

function severityLed(severity: InsightSeverityApi): string {
  if (severity === "critical" || severity === "high") return CHART.red;
  if (severity === "medium") return CHART.amber;
  return CHART.faint;
}

function dynamicBadge(it: InsightListItemApi): {
  label: string;
  tone: ChipTone;
} {
  const times =
    it.sourceBlocksCount > 1 ? ` ×${it.sourceBlocksCount}` : "";
  const map: Record<
    InsightDynamicApi,
    { label: string; tone: ChipTone; count: boolean }
  > = {
    spike: { label: "всплеск", tone: "risk", count: true },
    growing: { label: "растёт", tone: "warn", count: true },
    stable: { label: "стабильно", tone: "neutral", count: false },
    declining: { label: "снижается", tone: "ok", count: false },
  };
  const entry = map[it.dynamicLabel];
  return {
    label: entry.count ? `${entry.label}${times}` : entry.label,
    tone: entry.tone,
  };
}

type CauseGroupKey = "people" | "tooling" | "process";

const GROUP_ORDER: CauseGroupKey[] = ["people", "tooling", "process"];

const GROUP_LABEL: Record<CauseGroupKey, string> = {
  people: "Коммуникация и люди",
  tooling: "Инструменты",
  process: "Процессы",
};

const GROUP_DOT: Record<CauseGroupKey, string> = {
  people: CHART.red,
  tooling: CHART.amber,
  process: CHART.faint,
};

function causeGroupOf(cause: InsightCauseCategoryApi | null): CauseGroupKey {
  if (cause === "communication" || cause === "role_skill") return "people";
  if (cause === "tooling") return "tooling";
  return "process";
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
        <b style={{ color: CHART.text, fontWeight: 600 }}>Резюме за неделю:</b>{" "}
        {children}
      </div>
    </div>
  );
}

function SignalRow({
  led,
  title,
  meta,
  badge,
  onClick,
  href,
}: {
  led: string;
  title: string;
  meta?: string;
  badge: { label: string; tone: ChipTone };
  onClick?: () => void;
  href?: string;
}) {
  const clickable = Boolean(onClick) || Boolean(href);
  const base = "flex items-center gap-3 rounded-xl px-2 py-2.5";
  const inner = (
    <>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: led, boxShadow: `0 0 8px ${led}` }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium" style={{ color: CHART.text }}>
          {title}
        </span>
        {meta ? (
          <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: CHART.faint }}>
            {meta}
          </span>
        ) : null}
      </span>
      <Chip tone={badge.tone}>{badge.label}</Chip>
      {clickable ? (
        <ArrowUpRight size={15} className="shrink-0" style={{ color: CHART.faint, opacity: 0.6 }} aria-hidden />
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`${base} transition-colors hover:bg-[var(--surface-hover)]`}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} w-full text-left transition-colors hover:bg-[var(--surface-hover)]`}>
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

function GroupHeader({
  groupKey,
  count,
}: {
  groupKey: CauseGroupKey;
  count: number;
}) {
  const dot = GROUP_DOT[groupKey];
  return (
    <div className="mb-0.5 mt-3.5 flex items-center gap-2">
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{
          background: dot,
          boxShadow: groupKey === "process" ? undefined : `0 0 8px ${dot}`,
        }}
        aria-hidden
      />
      <span
        className="text-[11px] font-bold uppercase tracking-[0.05em]"
        style={{ color: CHART.faint }}
      >
        {GROUP_LABEL[groupKey]}
      </span>
      <span className="text-[11px] font-semibold" style={{ color: CHART.dim }}>
        · {count}
      </span>
    </div>
  );
}

function frictionMeta(fr: OperationsTeamFrictionApi): {
  title: string;
  meta: string;
} {
  const from = fr.fromPersonName ?? "—";
  const to = fr.toPersonName ?? "—";
  return { title: `${from} ↔ ${to}`, meta: fr.explanation };
}

export function WeekSignalsGrid({
  insights,
  frictions,
  clusters,
  risksSummary,
  ideasSummary,
}: {
  insights: InsightListItemApi[];
  frictions: OperationsTeamFrictionApi[];
  clusters: IdeaClusterApi[];
  risksSummary: string | null;
  ideasSummary: string | null;
}) {
  const [showAllClusters, setShowAllClusters] = useState(false);
  const { currentOrgId } = useAuth();
  const [activeSignal, setActiveSignal] = useState<{
    entityType: ProvenanceEntityTypeApi;
    id: string;
    title: string;
  } | null>(null);

  const grouped: Record<CauseGroupKey, InsightListItemApi[]> = {
    people: [],
    tooling: [],
    process: [],
  };
  for (const it of insights) {
    grouped[causeGroupOf(it.causeCategory)].push(it);
  }

  const groups: Array<{
    key: CauseGroupKey;
    insights: InsightListItemApi[];
    frictions: OperationsTeamFrictionApi[];
  }> = GROUP_ORDER.map((key) => ({
    key,
    insights: grouped[key],
    frictions: key === "people" ? frictions : [],
  })).filter((g) => g.insights.length > 0 || g.frictions.length > 0);

  const hasRisks = insights.length > 0 || frictions.length > 0;

  const visibleClusters = showAllClusters
    ? clusters
    : clusters.slice(0, CLUSTERS_VISIBLE);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div style={glass()} className="p-6">
        <div className="flex items-center gap-3">
          <CardTitle icon={<AlertTriangle size={17} />} grad={RED_GRADIENT}>
            Риски / что мешает — по причине
          </CardTitle>
          <Link
            href="/insights"
            className="ml-auto text-xs font-medium"
            style={{ color: CHART.dim }}
          >
            Радар →
          </Link>
        </div>

        {risksSummary ? (
          <div className="mt-4">
            <AiSummary>{risksSummary}</AiSummary>
          </div>
        ) : (
          <div className="mt-4" />
        )}

        {!hasRisks ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            За эту неделю рисков и трений не зафиксировано.
          </p>
        ) : (
          <div className="flex flex-col">
            {groups.map((g) => (
              <div key={g.key}>
                <GroupHeader
                  groupKey={g.key}
                  count={g.insights.length + g.frictions.length}
                />
                {g.insights.map((it) => (
                  <SignalRow
                    key={it.id}
                    led={severityLed(it.severity)}
                    title={it.statement}
                    badge={dynamicBadge(it)}
                    onClick={
                      it.sourceBlocksCount > 0
                        ? () =>
                            setActiveSignal({
                              entityType: "insight",
                              id: it.id,
                              title: it.statement,
                            })
                        : undefined
                    }
                  />
                ))}
                {g.frictions.map((fr) => {
                  const { title, meta } = frictionMeta(fr);
                  const led =
                    fr.confidence >= 0.8 ? CHART.red : CHART.amber;
                  return (
                    <SignalRow
                      key={fr.id}
                      led={led}
                      title={title}
                      meta={meta}
                      badge={{
                        label: `уверенность ${Math.round(fr.confidence * 100)}%`,
                        tone: "warn",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={glass()} className="p-6">
        <div className="flex items-center gap-3">
          <CardTitle icon={<Lightbulb size={17} />} grad={GRAD.teal}>
            Идеи — по кластерам
          </CardTitle>
          <Link
            href="/ideas"
            className="ml-auto text-xs font-medium"
            style={{ color: CHART.dim }}
          >
            Все идеи →
          </Link>
        </div>

        {ideasSummary ? (
          <div className="mt-4">
            <AiSummary>{ideasSummary}</AiSummary>
          </div>
        ) : (
          <div className="mt-4" />
        )}

        {clusters.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.faint }}>
            За эту неделю новых идей не собрано.
          </p>
        ) : (
          <>
            <div className="flex flex-col">
              {visibleClusters.map((cluster) => {
                const count = cluster.ideaIds.length;
                const ideasWord = pluralRu(count, ["идея", "идеи", "идей"]);
                const meta = cluster.description
                  ? `${count} ${ideasWord} · ${cluster.description}`
                  : `${count} ${ideasWord}`;
                const badge: { label: string; tone: ChipTone } =
                  count <= 1
                    ? { label: "ново", tone: "neutral" }
                    : { label: "растёт", tone: "warn" };
                return (
                  <SignalRow
                    key={cluster.id}
                    led={CHART.mint}
                    title={cluster.name}
                    meta={meta}
                    badge={badge}
                    href="/ideas"
                  />
                );
              })}
            </div>
            {clusters.length > CLUSTERS_VISIBLE && !showAllClusters ? (
              <button
                type="button"
                onClick={() => setShowAllClusters(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-[13px] font-semibold transition-colors hover:bg-[var(--surface-hover)]"
                style={{
                  background: "var(--surface-inset)",
                  borderColor: "var(--glass-border)",
                  color: CHART.dim,
                }}
              >
                Показать все кластеры ({clusters.length})
              </button>
            ) : null}
          </>
        )}
      </div>
      </div>
      <ProvenanceDrawer
        open={Boolean(activeSignal)}
        onOpenChange={(o) => {
          if (!o) setActiveSignal(null);
        }}
        orgId={currentOrgId}
        entityType={activeSignal?.entityType ?? "insight"}
        entityId={activeSignal?.id ?? null}
        title={activeSignal?.title}
      />
    </>
  );
}
