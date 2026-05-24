'use client';

/**
 * `<TopHelpfulWidget />` — мини-блок «Помощники недели» (Specialist 3.8).
 *
 * Источник: `/api/v1/admin/helpfulness/team-map` (admin-only) — мы намеренно
 * НЕ показываем рейтинг «лучших» обычным пользователям. Виджет рендерится
 * только если у текущего пользователя есть права (owner/admin) — иначе
 * молча отдаём `null`, чтобы не мигать пустотой.
 *
 * Берёт top-3 по lastWeekHelpCount, имена + темы экспертизы. Никаких «худших»
 * (по ТЗ — рейтингов нет, есть только подсветка позитива).
 *
 * Использование (на COO Dashboard / на /me/dashboard для руководителя):
 *   <TopHelpfulWidget orgId={currentOrgId} />
 */

import Link from 'next/link';
import useSWR from 'swr';
import { Sparkles, Users } from 'lucide-react';

import { helpfulnessApi } from '@/api/helpfulness.api';
import { useAuth } from '@/contexts/auth-context';
import { mapTeamMap, type TeamHelperRow } from '@/domain/helpfulness';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

type Props = {
  /** orgId — для cache-ключа SWR; права проверяются на бэке (403 → null). */
  orgId: string | null;
  /** Лимит строк (по умолчанию 3). */
  limit?: number;
};

export function TopHelpfulWidget({ orgId, limit = 3 }: Props) {
  const { currentOrgRole } = useAuth();
  const canSee =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const swrKey =
    canSee && orgId ? ['helpfulness/team-map', orgId] : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    async () => {
      const rows = await helpfulnessApi.getAdminTeamMap();
      return mapTeamMap(rows);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (!canSee) return null;

  const top: TeamHelperRow[] = (data ?? [])
    .filter((r) => r.lastWeekHelpCount > 0)
    .sort((a, b) => b.lastWeekHelpCount - a.lastWeekHelpCount)
    .slice(0, limit);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles size={16} className="text-accent" />
          Помощники недели
        </CardTitle>
        <Link
          href="/admin/helpfulness-overview"
          className="text-xs text-accent hover:underline"
        >
          Все
        </Link>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isLoading && (
          <>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-fg-tertiary">
            Не удалось загрузить помощников недели.
          </p>
        )}

        {!isLoading && !error && top.length === 0 && (
          <p className="text-fg-tertiary">
            На этой неделе пока никто не выделился — данные накопятся.
          </p>
        )}

        {!isLoading && top.length > 0 && (
          <ul className="space-y-2">
            {top.map((row) => (
              <li
                key={row.userId}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-fg-primary">
                    <Users size={12} className="shrink-0 text-fg-tertiary" />
                    <span className="truncate font-medium">
                      {row.name ?? 'Без имени'}
                    </span>
                  </div>
                  {row.topTopics.length > 0 && (
                    <p className="truncate text-xs text-fg-tertiary">
                      {row.topTopics.slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-md bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                  {row.lastWeekHelpCount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
