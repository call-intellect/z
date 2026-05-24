'use client';

/**
 * `<HelpRequestsWidget />` — ⚠ ADMIN-ONLY — открытые «вопросы без ответа»
 * (Specialist 3.8).
 *
 * Источник: `/api/v1/admin/helpfulness/unanswered` — приватные негативные
 * сигналы. По ТЗ §«Privacy & Ethics» эти данные НЕ показываются нигде, кроме
 * админ-интерфейса. Виджет рендерится только если у пользователя есть права
 * (owner/admin) — иначе возвращает null без флэша.
 *
 * Использование:
 *   - Только на `/admin/helpfulness-overview` или admin dashboard.
 *   - НЕ встраивать в публичные ленты / /me / COO Dashboard.
 */

import Link from 'next/link';
import useSWR from 'swr';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { helpfulnessApi } from '@/api/helpfulness.api';
import { useAuth } from '@/contexts/auth-context';
import { mapUnanswered, type UnansweredQuestionRow } from '@/domain/helpfulness';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

type Props = {
  /** orgId — для cache-ключа SWR; права проверяются на бэке (403 → ничего). */
  orgId: string | null;
  /** Лимит карточек (по умолчанию 5). */
  limit?: number;
};

export function HelpRequestsWidget({ orgId, limit = 5 }: Props) {
  const { currentOrgRole } = useAuth();
  const canSee =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const swrKey =
    canSee && orgId ? ['helpfulness/unanswered', orgId] : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    async () => {
      const rows = await helpfulnessApi.getAdminUnanswered();
      return mapUnanswered(rows);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (!canSee) return null;

  const items: UnansweredQuestionRow[] = (data ?? []).slice(0, limit);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle size={16} className="text-warning" />
          Открытые вопросы без ответа
        </CardTitle>
        <Link
          href="/admin/helpfulness-overview"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          Подробнее <ArrowRight size={11} />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-fg-tertiary">
          Видно только администратору и руководителю. Не показывается публично
          и не отображается сотруднику.
        </p>

        {isLoading && (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-fg-tertiary">Не удалось загрузить список.</p>
        )}

        {!isLoading && !error && items.length === 0 && (
          <p className="text-fg-tertiary">
            Сейчас нет открытых вопросов без ответа — всё в порядке.
          </p>
        )}

        {!isLoading && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-border-subtle bg-bg-elevated p-3"
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-tertiary">
                  <span className="font-medium text-fg-secondary">
                    {row.recipientName ?? 'Сотрудник'}
                  </span>
                  <span>не получил(а) ответ от</span>
                  <span className="font-medium text-fg-secondary">
                    {row.helperName ?? 'коллеги'}
                  </span>
                  {row.topicHint && (
                    <span className="truncate">· {row.topicHint}</span>
                  )}
                </div>
                {row.evidenceQuote && (
                  <blockquote className="border-l-2 border-border-subtle pl-2 text-xs italic text-fg-tertiary">
                    «{row.evidenceQuote}»
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
