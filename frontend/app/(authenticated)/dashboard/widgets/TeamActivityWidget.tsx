'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, Users } from 'lucide-react';

import { coraFeedApi } from '@/api/cora-feed.api';
import { coraFeedItemFromApi, type CoraFeedItem } from '@/domain/cora-feed';
import {
  CardTitle as ModernCardTitle,
  CHART,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * A11.4 — виджет «Активность команды» на экране «Сегодня».
 *
 * Показывает последние действия команды — «кто что сделал»: признания
 * (recognition), задачи (task) и решения (decision). Это НЕ деньги и НЕ оценка
 * человека — твёрдая лента активности.
 *
 * Источник — «Лента Коры» (`GET /api/v1/feed/cora?type=activity`), где
 * `activity` на бэке = `ActivityFeedItem(feedType in recognition|task)` —
 * именно «кто что сделал» (см. cora-feed.service.ts collectActivity). Это
 * чистейший существующий источник под задачу — отдельный бэкенд не нужен.
 *
 * Три состояния (Б-6):
 *   - loading — тихий placeholder без чисел;
 *   - пусто — нейтральная подсказка (канал есть, но пока тихо);
 *   - есть данные — топ-5 с тоном по severity + опц. клик в источник-встречу.
 *
 * Сбой загрузки не валит экран — виджет молчит (SWR shouldRetryOnError:false),
 * как и соседние «мягкие» блоки «Сегодня».
 */

/** Тон точки/чипа по severity ленты (парные токены). */
function activityTone(item: CoraFeedItem): { dot: string; chipBg: string } {
  if (item.tone === 'danger') {
    return { dot: CHART.red, chipBg: 'var(--chip-danger-bg)' };
  }
  if (item.tone === 'warning') {
    return { dot: CHART.amber, chipBg: 'var(--chip-warning-bg)' };
  }
  return { dot: CHART.mint, chipBg: 'var(--chip-success-bg)' };
}

export function TeamActivityWidget({ orgId }: { orgId: string | null }) {
  const activitySwr = useSWR<CoraFeedItem[]>(
    orgId ? ['today-team-activity', orgId] : null,
    async () => {
      const res = await coraFeedApi.list(orgId, {
        type: 'activity',
        window: 'all',
        limit: 5,
      });
      return (res.items ?? []).map(coraFeedItemFromApi);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const items = useMemo(
    () => (activitySwr.data ?? []).slice(0, 5),
    [activitySwr.data],
  );
  const isLoading = activitySwr.isLoading || activitySwr.data === undefined;
  const isEmpty = !isLoading && items.length === 0;

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ModernCardTitle icon={<Users size={16} />} grad={GRAD.teal}>
          Активность команды
        </ModernCardTitle>
        <Link
          href="/feed"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
          style={{ color: CHART.cyan }}
        >
          Открыть ленту
          <ArrowRight size={13} />
        </Link>
      </div>

      {isLoading ? (
        // Loading / молчаливый сбой — без чисел.
        <p className="text-sm" style={{ color: CHART.faint }}>
          Собираем активность команды…
        </p>
      ) : isEmpty ? (
        // Пусто — нейтральная подсказка, канал есть, но пока тихо.
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm" style={{ color: CHART.dim }}>
            — Действия команды появятся, когда Кора зафиксирует задачи, признания
            и решения со встреч.
          </p>
          <Link
            href="/meetings"
            className="text-sm font-medium hover:underline"
            style={{ color: CHART.cyan }}
          >
            К встречам →
          </Link>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const tone = activityTone(item);
            const href = item.meetingId
              ? `/meetings/${encodeURIComponent(item.meetingId)}`
              : '/feed';
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                    style={{ background: tone.chipBg }}
                    aria-hidden
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: tone.dot, boxShadow: `0 0 8px ${tone.dot}` }}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: CHART.text }}>
                      {item.title}
                    </div>
                    {item.analysis && (
                      <div className="truncate text-xs" style={{ color: CHART.faint }}>
                        {item.analysis}
                      </div>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: tone.chipBg, color: tone.dot }}
                  >
                    {item.typeLabel}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}
