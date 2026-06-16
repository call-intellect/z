"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import {
  fromChronicBlockersApi,
  type ChronicBlockerStatus,
} from "@/domain/operations-dashboard";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  STATUS_TONE,
} from "@/ui/components/dashboard/modern";

const STATUS_PILL_TONE: Record<
  ChronicBlockerStatus,
  "ok" | "warning" | "risk"
> = {
  new: "warning",
  recurring: "risk",
  resolved: "ok",
};

function StatusPill(props: { status: ChronicBlockerStatus; label: string }) {
  const tone = STATUS_TONE[STATUS_PILL_TONE[props.status]];
  return (
    <span
      className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
      style={{ color: tone.c, background: tone.bg }}
    >
      {props.label}
    </span>
  );
}

export function ChronicBlockersWidget() {
  const swr = useSWR(
    ["operations-chronic-blockers", 10],
    () => operationsDashboardApi.getChronicBlockers({ limit: 10 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const items = swr.data ? fromChronicBlockersApi(swr.data) : null;

  return (
    <GlassCard>
      <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.amber}>
        Хронические блокеры
      </CardTitle>

      <div className="mt-4">
        {swr.isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка…
          </p>
        ) : swr.error ? (
          <p className="text-sm" style={{ color: CHART.red }}>
            {swr.error instanceof Error
              ? swr.error.message
              : "Не удалось загрузить данные"}
          </p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Хронических блокеров нет.
          </p>
        ) : (
          <ul className="space-y-3">
            {items.map((b) => (
              <li
                key={b.id}
                className="rounded-xl p-3"
                style={{ background: "var(--surface-inset)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex-1 text-sm">{b.representativeText}</span>
                  <StatusPill status={b.status} label={b.statusLabel} />
                </div>
                <div
                  className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                  style={{ color: CHART.faint }}
                >
                  <span className="tabular-nums">{b.daysOpen} дн. открыт</span>
                  {b.linkedInsightId ? (
                    <Link
                      href={`/insights/${b.linkedInsightId}`}
                      className="hover:underline"
                      style={{ color: CHART.cyan }}
                    >
                      Причина: повторяющийся сигнал
                    </Link>
                  ) : (
                    <span>
                      замечен {b.firstSeenDateLocal} → {b.lastSeenDateLocal}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
