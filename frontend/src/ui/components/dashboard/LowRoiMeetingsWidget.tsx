"use client";

import Link from "next/link";
import { Coffee, TrendingDown } from "lucide-react";

import type { PulsePatternLowRoiMeetingDomain } from "@/domain/pulse-patterns";
import { MiniBarRow } from "@/ui/components/dashboard/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";

type Props = {
  meetings: PulsePatternLowRoiMeetingDomain[];
  loading: boolean;
  error: string | null;
};

const ROI_DEFAULT_MAX = 10;

export function LowRoiMeetingsWidget({ meetings, loading, error }: Props) {
  const maxRoi = meetings.reduce(
    (acc, m) => (m.roiScore > acc ? m.roiScore : acc),
    ROI_DEFAULT_MAX,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown size={16} className="text-chip-warning-fg" />
          Встречи с низкой отдачей
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}
        {!loading && !error && meetings.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-bg-overlay/40 p-6 text-center">
            <Coffee size={28} className="text-chip-success-fg" />
            <p className="text-sm text-fg-secondary">
              Все встречи в норме — болтологии за период не зафиксировано.
            </p>
          </div>
        )}
        {!loading && !error && meetings.length > 0 && (
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li key={m.meetingId}>
                <Link
                  href={`/meetings/${encodeURIComponent(m.meetingId)}/result`}
                  className="block rounded-md p-2 transition-colors hover:bg-chip-danger-bg/5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg-primary">
                      {m.title}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-tertiary">
                      {m.durationMinutes} мин · {m.participantCount} участ. ·{" "}
                      {m.startedAt.toLocaleDateString("ru", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <div className="mt-2">
                    <MiniBarRow
                      value={m.roiScore}
                      max={maxRoi}
                      tone="danger"
                      label="ROI"
                      suffix=""
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
