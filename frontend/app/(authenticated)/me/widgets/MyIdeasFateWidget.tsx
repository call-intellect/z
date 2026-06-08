'use client';

import Link from 'next/link';
import { Lightbulb } from 'lucide-react';
import useSWR from 'swr';

import { meDailyValueApi } from '@/api/me-daily-value.api';
import { IDEA_STATUS_LABEL } from '@/domain/idea';
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-2 Ф5 — виджет «Судьба моих идей» (self-scope). Self-fetch через SWR на
 * `meDailyValueApi.ideas()` (мои идеи как автора). Каждая строка — текст идеи
 * (clamp) + RU-статус (`IDEA_STATUS_LABEL`). Современный визуальный язык.
 *
 * Эндпоинт гейтится kill-switch на бэке: OFF → пустой ответ → empty-state.
 */
export function MyIdeasFateWidget() {
  const swr = useSWR(['me-ideas-fate'], () => meDailyValueApi.ideas(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const items = swr.data?.items ?? [];

  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3">
        <CardTitle icon={<Lightbulb size={16} />} grad={GRAD.amber}>
          Судьба моих идей
        </CardTitle>
        <Link
          href="/ideas"
          className="text-xs hover:underline"
          style={{ color: CHART.cyan }}
        >
          Все →
        </Link>
      </div>

      <div className="mt-4">
        {swr.isLoading ? (
          <ul className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-xl"
                style={{ background: 'oklch(1 0 0 / 0.05)' }}
              />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            Вы ещё не предлагали идей.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((idea) => (
              <li key={idea.id}>
                <Link
                  href={`/ideas/${encodeURIComponent(idea.id)}`}
                  className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-[oklch(1_0_0_/_0.05)]"
                >
                  <p
                    className="line-clamp-2 text-sm"
                    style={{ color: CHART.text }}
                  >
                    {idea.statement}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className="rounded-full px-2 py-0.5 font-medium"
                      style={{
                        background: 'oklch(1 0 0 / 0.06)',
                        color: CHART.dim,
                      }}
                    >
                      {IDEA_STATUS_LABEL[idea.status] ?? idea.status}
                    </span>
                    {idea.supporterCount > 0 && (
                      <span style={{ color: CHART.faint }}>
                        поддержали: {idea.supporterCount}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
