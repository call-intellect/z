'use client';

/**
 * useCards — SWR-хук списка карточек CRM (клиенты / контакты).
 *
 * Backend: `GET /api/v1/cards` (модуль cards).
 *
 * Для SprintCreateWizard scope='customer' используем фильтр kind='client'.
 */
import { useMemo } from 'react';
import useSWR from 'swr';

import {
  cardsApi,
  type ListCardsRequest,
} from '@/api/cards.api';
import type { CardApi } from '@/domain/card';

export function useCards(
  orgId: string | null | undefined,
  filters: ListCardsRequest = {},
): {
  cards: CardApi[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? [
        'cards.list',
        orgId,
        filters.kind ?? null,
        filters.q ?? '',
        filters.archived ?? null,
        filters.pinned ?? null,
        filters.limit ?? 20,
      ]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return cardsApi.list({ ...filters, limit: filters.limit ?? 20 });
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const cards = useMemo<CardApi[]>(
    () => swr.data?.items ?? [],
    [swr.data],
  );

  return {
    cards,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
