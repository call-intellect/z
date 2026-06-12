'use client';

/**
 * MobileMemoryClient — мобильный таб «Память» менеджера (ТЗ B5/Ф6
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B; полный контракт —
 * `2026-06-11-mobile-cora-exec-manager.md` §Ф6).
 *
 * Инвариант №1: мобайл = тот же web-app, читает ТОТ ЖЕ источник, что десктопный
 * `DecisionsListClient`: `decisionsApi.list` → `mapDecisionListItem`. Десктоп НЕ
 * меняем. Видимость решений определяет backend (RBAC `decision:read` за
 * `TenantGuard`) — на фронте дополнительно НИЧЕГО не фильтруем.
 *
 * Раскладка (один столбец, max-w-md):
 *   - поле поиска (debounce ~300мс) → `q` в запрос;
 *   - лента карточек: тег «Решение» (парный chip-токен) + статус, заголовок
 *     (statement), дата (ru) и подпись-источник.
 *
 * Детального мобильного роута `/decisions/[id]` нет (десктоп — master-detail на
 * одной странице), поэтому карточки не ссылки — лента «для чтения». Когда роут
 * детали появится, добавим href.
 *
 * Чистая логика (формат даты, лейбл/тон статуса, маппинг карточки) — в
 * `memory-rows.ts` (юнит-тест).
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { AlertCircle, BookOpen, Search } from 'lucide-react';

import { decisionsApi } from '@/api/decisions.api';
import { humanizeApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { mapDecisionListItem } from '@/domain/decision';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { memoryCards, type ChipTone, type MemoryCard } from './memory-rows';

const CHIP_CLASS: Record<ChipTone, string> = {
  success: 'bg-chip-success-bg text-chip-success-fg',
  danger: 'bg-chip-danger-bg text-chip-danger-fg',
  warning: 'bg-chip-warning-bg text-chip-warning-fg',
  info: 'bg-chip-info-bg text-chip-info-fg',
  neutral: 'bg-bg-muted text-fg-secondary',
};

/** Дебаунс значения поиска (~300мс) — без внешних зависимостей. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function MobileMemoryClient() {
  const { currentOrgId } = useAuth();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query.trim(), 300);

  const swr = useSWR(
    currentOrgId
      ? (['decisions', currentOrgId, debouncedQuery] as const)
      : null,
    async ([, , q]) => {
      const res = await decisionsApi.list({
        ...(q ? { q } : {}),
        limit: 20,
      });
      return res.items.map(mapDecisionListItem);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  );

  const items = swr.data ?? null;
  const cards = useMemo<MemoryCard[]>(
    () => (items ? memoryCards(items) : []),
    [items],
  );

  const loading = !!currentOrgId && swr.isLoading && !items;
  const error = swr.error
    ? humanizeApiError(swr.error, 'Не удалось загрузить память')
    : null;
  const isSearching = debouncedQuery.length > 0;
  const empty = !loading && !error && items !== null && cards.length === 0;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <BookOpen size={20} className="text-accent" aria-hidden />
        Память
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Свежие решения и договорённости компании.
      </p>

      {/* Поиск. */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по решениям"
          aria-label="Поиск по решениям"
          className="pl-9"
        />
      </div>

      {loading && <MemorySkeleton />}

      {!loading && error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && empty && (
        <div
          data-testid="memory-empty"
          className="rounded-2xl border border-border-subtle bg-bg-card p-5 text-center"
        >
          <BookOpen size={24} className="mx-auto mb-2 text-accent" aria-hidden />
          <p className="text-base font-medium text-fg-primary">
            {isSearching ? 'Ничего не нашлось' : 'Память пока пуста'}
          </p>
          <p className="mt-1 text-sm text-fg-secondary">
            {isSearching
              ? 'Попробуйте другой запрос — например, по теме или сути решения.'
              : 'Решения появятся автоматически, когда Кора обработает встречи и документы.'}
          </p>
        </div>
      )}

      {!loading && !error && !empty && cards.length > 0 && (
        <ul className="space-y-3" data-testid="memory-list">
          {cards.map((card) => (
            <li
              key={card.id}
              className="rounded-2xl border border-border-subtle bg-bg-card p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-chip-info-bg px-2 py-0.5 text-xs font-medium text-chip-info-fg">
                  Решение
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${CHIP_CLASS[card.statusTone]}`}
                >
                  {card.statusLabel}
                </span>
              </div>
              <p className="text-sm font-medium text-fg-primary">
                {card.statement}
              </p>
              <p className="mt-2 text-xs text-fg-tertiary">
                {card.sourceLabel} · {card.dateLabel}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemorySkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}
