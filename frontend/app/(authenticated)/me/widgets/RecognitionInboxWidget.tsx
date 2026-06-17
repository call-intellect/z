"use client";

import { Award } from "lucide-react";
import useSWR from "swr";

import { meDailyValueApi } from "@/api/me-daily-value.api";
import { mapMyRecognition } from "@/domain/me-daily-value";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

export function RecognitionInboxWidget() {
  const swr = useSWR(
    ["me-recognitions"],
    async () =>
      (await meDailyValueApi.recognitions()).items.map(mapMyRecognition),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const items = swr.data ?? [];

  return (
    <GlassCard>
      <CardTitle icon={<Award size={16} />} grad={GRAD.pink}>
        Признания
      </CardTitle>

      <div className="mt-4">
        {swr.isLoading ? (
          <ul className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-xl"
                style={{ background: "var(--surface-inset)" }}
              />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            Пока нет признаний.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((r) => (
              <li
                key={r.id}
                className="rounded-xl px-3 py-2.5"
                style={{ background: "var(--surface-inset)" }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      background: "oklch(0.78 0.2 350 / 0.14)",
                      color: CHART.pink,
                    }}
                  >
                    {r.typeLabel}
                  </span>
                </div>
                {r.message && (
                  <p className="mt-1.5 text-sm" style={{ color: CHART.text }}>
                    {r.message}
                  </p>
                )}
                <div
                  className="mt-1 flex flex-wrap items-center gap-2 text-[11px]"
                  style={{ color: CHART.faint }}
                >
                  <span>от {r.fromPersonName ?? "коллеги"}</span>
                  <span aria-hidden>·</span>
                  <span>{formatRuDate(r.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}

function formatRuDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    return "";
  }
}
