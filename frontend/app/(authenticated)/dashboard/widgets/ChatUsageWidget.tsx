'use client';

import type { ReactNode } from 'react';
import { BookOpenCheck, MessagesSquare, ThumbsUp } from 'lucide-react';
import useSWR from 'swr';

import { chatV2Api } from '@/api/chat-v2.api';
import { chatUsageStatsFromApi } from '@/domain/chat-usage';
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-1 Ф5 — виджет «Память в работе» (метрика AI-чата). Self-fetch через SWR
 * на `chatV2Api.usageStats({ scope: 'org' })`.
 *
 * Показывает «спросили / ответили / ответы с источником», а процент «помог ли
 * ответ» — ТОЛЬКО когда `helpedRateHidden=false`; иначе «мало данных».
 * `answeredWithCitation` подписан «ответы с источником» (НЕ «дефлекция»).
 * Современный визуальный язык (стекло + градиентный заголовок), токены `modern/`.
 */
export function ChatUsageWidget() {
  const swr = useSWR(
    ['chat-usage-stats', 'org'],
    async () => chatUsageStatsFromApi(await chatV2Api.usageStats({ scope: 'org' })),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const stats = swr.data;

  return (
    <GlassCard>
      <CardTitle icon={<MessagesSquare size={16} />} grad={GRAD.teal}>
        Память в работе
      </CardTitle>

      <div className="mt-4">
        {swr.isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl"
                style={{ background: 'oklch(1 0 0 / 0.05)' }}
              />
            ))}
          </div>
        ) : !stats || stats.asked === 0 ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            За период память ещё ни о чём не спрашивали.
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
                label="ответы с источником"
              />
            </div>

            <div
              className="mt-4 flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: 'oklch(1 0 0 / 0.04)' }}
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
                  мало данных
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
      style={{ background: 'oklch(1 0 0 / 0.04)' }}
    >
      <div
        className="grid h-8 w-8 place-items-center rounded-lg"
        style={{ background: 'oklch(1 0 0 / 0.06)', color: tone }}
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
