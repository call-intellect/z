'use client';

import Link from 'next/link';
import { Lightbulb, Users } from 'lucide-react';
import useSWR from 'swr';

import { ideasApi } from '@/api/ideas.api';
import { useAuth } from '@/contexts/auth-context';
import { ideaHref, IDEA_KIND_LABEL, IDEA_STATUS_LABEL } from '@/domain/idea';
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-1 Ф4.A — виджет «Идеи» (топ идей по ре-ранку). Self-fetch через SWR на
 * `ideasApi.top(orgId, 5)`. Структура — как у `InsightsTopWidget`, но на
 * современном визуальном языке (стекло + градиентный заголовок), токены
 * из `modern/`.
 *
 * Доступ к эндпоинту: owner/admin/coo. Если у пользователя нет доступа или
 * данных нет — graceful empty-state «Идей пока нет». Загрузка — скелетон.
 */
export function IdeasTopWidget() {
  const { currentOrgId } = useAuth();
  const swr = useSWR(
    currentOrgId ? ['ideas-top', currentOrgId] : null,
    () => ideasApi.top(currentOrgId!, 5),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const items = swr.data?.items ?? [];

  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3">
        <CardTitle icon={<Lightbulb size={16} />} grad={GRAD.amber}>
          Идеи
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
                style={{ background: 'var(--surface-inset)' }}
              />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm" style={{ color: CHART.faint }}>
            Идей пока нет.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((idea) => (
              <li key={idea.id}>
                <Link
                  href={ideaHref(idea.id)}
                  className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
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
                        background: 'var(--surface-inset)',
                        color: CHART.dim,
                      }}
                    >
                      {IDEA_STATUS_LABEL[idea.status]}
                    </span>
                    <span style={{ color: CHART.faint }}>
                      {IDEA_KIND_LABEL[idea.kind]}
                    </span>
                    {idea.supporterCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1"
                        style={{ color: CHART.faint }}
                      >
                        <Users size={11} />
                        {idea.supporterCount}
                      </span>
                    )}
                    <span
                      className="tabular-nums"
                      style={{ color: CHART.faint }}
                    >
                      вес {Math.round(idea.weight)}
                    </span>
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
