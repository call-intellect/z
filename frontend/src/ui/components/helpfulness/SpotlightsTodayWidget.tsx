'use client';

/**
 * `<SpotlightsTodayWidget />` — встраиваемый виджет «Спасибо команде» (Specialist 3.8).
 *
 * Источник: `/api/v1/feed/spotlights?status=published&limit=3` — публично
 * (member любой Org).
 *
 * Принципы:
 *   - Показываем только одобренные руководителем спотлайты (status=published).
 *   - Никаких рейтингов / сравнений / «худших».
 *   - Минимум UI — message + имя помощника. Подробнее → /feed/spotlights.
 *
 * Использование:
 *   - На COO Dashboard / на главной — как «пульс благодарностей».
 *   - На странице `/feed/spotlights` — НЕ нужен (там полный список).
 */

import Link from 'next/link';
import useSWR from 'swr';
import { Heart, MessageSquareHeart } from 'lucide-react';

import { helpfulnessApi } from '@/api/helpfulness.api';
import {
  mapListSpotlights,
  type HelpfulnessSpotlight,
} from '@/domain/helpfulness';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

type Props = {
  /** orgId — для cache-ключа SWR. */
  orgId: string | null;
  /** Лимит карточек (по умолчанию 3). */
  limit?: number;
};

export function SpotlightsTodayWidget({ orgId, limit = 3 }: Props) {
  const swrKey = orgId
    ? ['helpfulness/feed-spotlights', orgId, limit]
    : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    async () => {
      const res = await helpfulnessApi.getFeedSpotlights({
        status: 'published',
        page: 1,
        limit,
      });
      return mapListSpotlights(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const items: HelpfulnessSpotlight[] = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareHeart size={16} className="text-accent" />
          Сегодня спасибо
        </CardTitle>
        <Link
          href="/feed/spotlights"
          className="text-xs text-accent hover:underline"
        >
          Вся лента
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading && (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-fg-tertiary">Не удалось загрузить ленту.</p>
        )}

        {!isLoading && !error && items.length === 0 && (
          <p className="text-fg-tertiary">
            Пока нет опубликованных благодарностей — спотлайты появятся после
            одобрения руководителем.
          </p>
        )}

        {!isLoading && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-border-subtle bg-bg-elevated p-3"
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs text-fg-tertiary">
                  <Heart size={11} className="text-accent" />
                  <span className="font-medium text-fg-secondary">
                    {s.helperName ?? 'Коллега'}
                  </span>
                  {s.topicHint && (
                    <span className="truncate">· {s.topicHint}</span>
                  )}
                </div>
                <p className="line-clamp-3 text-sm text-fg-primary">
                  {s.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
