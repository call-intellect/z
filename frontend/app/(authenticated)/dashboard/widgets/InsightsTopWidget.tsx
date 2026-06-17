"use client";

import { AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { insightsApi } from "@/api/insights.api";
import {
  INSIGHT_DYNAMIC_LABEL,
  INSIGHT_KIND_LABEL,
  INSIGHT_SEVERITY_LABEL,
  type InsightCauseCategory,
} from "@/domain/insight";
import {
  CAUSE_CATEGORY_BG_CLASS,
  CAUSE_CATEGORY_LABELS_RU,
} from "@/lib/cause-category-presentation";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function InsightsTopWidget() {
  const swr = useSWR(["insights-top"], async () => insightsApi.top(5), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const categoriesInResult: InsightCauseCategory[] = (() => {
    if (!swr.data) return [];
    const set = new Set<InsightCauseCategory>();
    for (const it of swr.data.items) {
      const cat = (it.causeCategory ?? "unknown") as InsightCauseCategory;
      set.add(cat);
    }
    return Array.from(set);
  })();

  return (
    <GlassCard>
      <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.amber}>
        Топ-5 повторяющихся проблем
      </CardTitle>
      <div className="mt-4">
        {swr.isLoading ? (
          <Skeleton className="h-32" />
        ) : !swr.data || swr.data.items.length === 0 ? (
          <p
            className="py-6 text-center text-xs"
            style={{ color: CHART.faint }}
          >
            Повторяющихся сигналов пока не выявлено.
          </p>
        ) : (
          <>
            {categoriesInResult.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {categoriesInResult.map((cat) => (
                  <Link
                    key={cat}
                    href={`/insights?cause_category=${cat}`}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CAUSE_CATEGORY_BG_CLASS[cat]} hover:opacity-80`}
                    title="Открыть все сигналы этой категории"
                  >
                    {CAUSE_CATEGORY_LABELS_RU[cat]}
                  </Link>
                ))}
              </div>
            ) : null}
            <ul className="space-y-2">
              {swr.data.items.map((it) => {
                const cat = (it.causeCategory ??
                  "unknown") as InsightCauseCategory;
                return (
                  <li key={it.id}>
                    <Link
                      href={`/insights/${it.id}`}
                      className="flex items-start justify-between gap-3 rounded-xl p-3 transition hover:brightness-110"
                      style={{ background: "var(--surface-inset)" }}
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className="line-clamp-2 text-sm"
                          style={{ color: CHART.text }}
                        >
                          {it.statement}
                        </p>
                        <div
                          className="mt-1 flex flex-wrap items-center gap-2 text-[10px]"
                          style={{ color: CHART.faint }}
                        >
                          <span
                            className={`rounded px-1.5 py-0.5 font-medium ${CAUSE_CATEGORY_BG_CLASS[cat]}`}
                          >
                            {CAUSE_CATEGORY_LABELS_RU[cat]}
                          </span>
                          <span>{INSIGHT_KIND_LABEL[it.kind]}</span>
                          <span>·</span>
                          <span>{INSIGHT_SEVERITY_LABEL[it.severity]}</span>
                          <span>·</span>
                          <span
                            style={
                              it.dynamicLabel === "spike" ||
                              it.dynamicLabel === "growing"
                                ? { color: CHART.red }
                                : undefined
                            }
                          >
                            <TrendingUp size={10} className="inline" />{" "}
                            {INSIGHT_DYNAMIC_LABEL[it.dynamicLabel]}
                          </span>
                        </div>
                      </div>
                      <div
                        className="flex flex-col items-end text-[10px]"
                        style={{ color: CHART.faint }}
                      >
                        <span className="tabular-nums">
                          {Math.round(it.frequencyScore * 100)}%
                        </span>
                        <span>{it.sourceBlocksCount} упом.</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="mt-3 flex justify-end">
          <Link
            href="/insights"
            className="inline-flex items-center gap-1 text-xs hover:underline"
            style={{ color: CHART.cyan }}
          >
            Открыть радар <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </GlassCard>
  );
}
