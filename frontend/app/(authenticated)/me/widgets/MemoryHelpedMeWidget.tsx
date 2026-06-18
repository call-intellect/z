"use client";

import type { ReactNode } from "react";
import { BookOpenCheck, MessagesSquare, ThumbsUp } from "lucide-react";
import useSWR from "swr";

import { chatV2Api } from "@/api/chat-v2.api";
import { chatUsageStatsFromApi } from "@/domain/chat-usage";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

export function MemoryHelpedMeWidget() {
  const swr = useSWR(
    ["me-chat-usage-stats", "self"],
    async () =>
      chatUsageStatsFromApi(await chatV2Api.usageStats({ scope: "self" })),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const stats = swr.data;

  return (
    <GlassCard>
      <CardTitle icon={<MessagesSquare size={16} />} grad={GRAD.teal}>
        Память помогла
      </CardTitle>

      <div className="mt-4">
        {swr.isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl"
                style={{ background: "var(--surface-inset)" }}
              />
            ))}
          </div>
        ) : !stats || stats.asked === 0 ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            Вы ещё ни о чём не спрашивали память.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                icon={<MessagesSquare size={16} />}
                tone={CHART.violet}
                value={stats.asked}
                label="спросили"
              />
              <Stat
                icon={<BookOpenCheck size={16} />}
                tone={CHART.teal}
                value={stats.answered}
                label="ответили"
              />
              <Stat
                icon={<BookOpenCheck size={16} />}
                tone={CHART.cyan}
                value={stats.answeredWithCitation}
                label="с источником"
              />
            </div>

            <div
              className="mt-4 flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: "var(--surface-inset)" }}
            >
              <span
                className="inline-flex items-center gap-2 text-sm"
                style={{ color: CHART.dim }}
              >
                <ThumbsUp size={14} />
                Помог ли ответ
              </span>
              {stats.helpedRateHidden ? (
                <span className="text-sm" style={{ color: CHART.faint }}>
                  мало оценок
                </span>
              ) : (
                <span
                  className="text-lg font-semibold tabular-nums"
                  style={{ color: CHART.mint }}
                >
                  {stats.helpedRatePercent ?? 0}%
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </GlassCard>
  );
}

function Stat({
  icon,
  tone,
  value,
  label,
}: {
  icon: ReactNode;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: "var(--surface-inset)" }}
    >
      <div
        className="grid h-8 w-8 place-items-center rounded-lg"
        style={{ background: "var(--surface-inset)", color: tone }}
      >
        {icon}
      </div>
      <div
        className="mt-2 text-2xl font-semibold leading-none tabular-nums"
        style={{ color: CHART.text }}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px]" style={{ color: CHART.dim }}>
        {label}
      </div>
    </div>
  );
}
