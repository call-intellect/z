'use client';

import Link from 'next/link';
import { Coffee, TrendingDown } from 'lucide-react';

import type { PulsePatternLowRoiMeetingDomain } from '@/domain/pulse-patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * LowRoiMeetingsWidget (Pulse Wave 6 §6.3) — «Топ-3 встречи-болтологии».
 *
 * Сортирует завершённые встречи по `Meeting.roiScore` ASC. Дает быстрый
 * drill-down на отчёт встречи.
 */

type Props = {
  meetings: PulsePatternLowRoiMeetingDomain[];
  loading: boolean;
  error: string | null;
};

export function LowRoiMeetingsWidget({ meetings, loading, error }: Props) {
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
                  className="block rounded-md p-2 hover:bg-bg-overlay/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg-primary">
                        {m.title}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-tertiary">
                        {m.durationMinutes} мин · {m.participantCount} участ. ·
                        {' '}
                        {m.startedAt.toLocaleDateString('ru', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-chip-warning-bg px-2.5 py-1 text-xs font-medium text-chip-warning-fg">
                      ROI {m.roiScore.toFixed(1)}
                    </span>
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
