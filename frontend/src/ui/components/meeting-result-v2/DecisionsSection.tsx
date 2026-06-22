"use client";

import useSWR from "swr";

import { decisionsApi } from "@/api/decisions.api";
import {
  DECISION_STATUS_LABEL,
  DECISION_STATUS_TONE,
  mapDecisionListItem,
  type DecisionListItem,
} from "@/domain/decision";

export interface DecisionsSectionProps {
  meetingId: string;
}

type DecisionTone = (typeof DECISION_STATUS_TONE)[DecisionListItem["status"]];

const TONE_CHIP: Record<DecisionTone, string> = {
  neutral: "bg-bg-overlay text-fg-secondary",
  success: "bg-chip-success-bg text-chip-success-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  error: "bg-chip-danger-bg text-chip-danger-fg",
  info: "bg-chip-info-bg text-chip-info-fg",
};

export function DecisionsSection({ meetingId }: DecisionsSectionProps) {
  const { data, error, isLoading } = useSWR(
    ["meeting-decisions", meetingId],
    async () => {
      const res = await decisionsApi.list({ meeting_id: meetingId, limit: 50 });
      return res.items.map(mapDecisionListItem);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (error && hasStatus403(error)) return null;
  if (isLoading && !data) return <PendingSkeleton />;
  if (error) return null;

  const decisions = data ?? [];

  return (
    <section
      data-testid="meeting-decisions-section"
      className="rounded-2xl border border-border-subtle bg-bg-card p-6 space-y-4"
    >
      <header>
        <h2 className="text-lg font-semibold text-fg-primary">
          Решения встречи
        </h2>
        <p className="text-xs text-fg-secondary">
          Зафиксированные решения, связанные с этой встречей.
        </p>
      </header>

      {decisions.length === 0 ? (
        <p className="rounded-lg bg-bg-subtle px-4 py-3 text-sm text-fg-secondary">
          Решения по этой встрече не выделены.
        </p>
      ) : (
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li
              key={d.id}
              className="rounded-lg border border-border-subtle bg-bg-subtle p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-fg-primary">{d.statement}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CHIP[DECISION_STATUS_TONE[d.status]]}`}
                >
                  {DECISION_STATUS_LABEL[d.status]}
                </span>
              </div>
              {d.decidedAt ? (
                <p className="mt-1 text-xs text-fg-tertiary">
                  {d.decidedAt.toLocaleDateString("ru-RU")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingSkeleton() {
  return (
    <section
      data-testid="meeting-decisions-section-loading"
      className="rounded-2xl border border-border-subtle bg-bg-card p-6 space-y-3"
    >
      <h2 className="text-lg font-semibold text-fg-primary">Решения встречи</h2>
      <div className="h-12 animate-pulse rounded-lg bg-bg-subtle" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-bg-subtle" />
    </section>
  );
}

function hasStatus403(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (
    typeof code === "string" &&
    (code === "http_403" || code === "forbidden")
  ) {
    return true;
  }
  const status = (err as { status?: unknown }).status;
  return status === 403;
}
