"use client";

import { KeyRound } from "lucide-react";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { fromKnowledgeAtRiskApi } from "@/domain/knowledge-at-risk";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  StatusPill,
} from "@/ui/components/dashboard/modern";

const SEVERITY_TONE: Record<string, "ok" | "warning" | "risk"> = {
  critical: "risk",
  warning: "warning",
  ok: "ok",
};

export function KnowledgeAtRiskWidget() {
  const swr = useSWR(
    ["operations-knowledge-at-risk"],
    () => operationsDashboardApi.getKnowledgeAtRisk().catch(() => null),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const all = swr.data ? fromKnowledgeAtRiskApi(swr.data) : null;
  const items = all
    ? all.filter((i) => i.combinedSeverity !== "ok").slice(0, 5)
    : [];

  return (
    <GlassCard>
      <CardTitle icon={<KeyRound size={16} />} grad={GRAD.amber}>
        Знания под риском
      </CardTitle>
      <div className="mt-4">
        {swr.isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Появится, когда соберётся достаточно данных (обновляется по
            понедельникам).
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <li
                key={i.categoryName}
                className="rounded-xl p-3"
                style={{ background: "var(--surface-inset)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="flex-1 text-sm"
                    style={{ color: CHART.text }}
                  >
                    Зона «{i.categoryName}» держится на одном человеке
                    {i.soleExpertPersonName
                      ? ` (${i.soleExpertPersonName})`
                      : ""}
                    {i.soleExpertPersonName ? ", он под риском ухода" : ""}
                  </span>
                  <StatusPill
                    status={SEVERITY_TONE[i.combinedSeverity] ?? "warning"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
