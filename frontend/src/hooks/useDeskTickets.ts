'use client';

/**
 * `useDeskTickets(view)` — очередь тикетов деска по выбранному view
 * (ТЗ 2026-06-09 support-desk). Источник: GET /api/v1/support/desk/tickets.
 *
 * `enabled=false` (например пользователь не агент) → ключ null, запрос не идёт.
 */

import useSWR, { type KeyedMutator } from 'swr';

import { supportApi, type DeskView } from '@/api/support.api';
import { toDeskTicketListItem, type DeskTicketListItem } from '@/domain/support';

export interface UseDeskTicketsResult {
  data: DeskTicketListItem[] | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<DeskTicketListItem[]>;
}

export function useDeskTickets(
  view: DeskView,
  enabled = true,
): UseDeskTicketsResult {
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ['support-desk-tickets', view] : null,
    () =>
      supportApi
        .listDeskTickets({ view })
        .then((res) => res.items.map(toDeskTicketListItem)),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
