'use client';

/**
 * `useMyTickets` — список моих обращений в поддержку (ТЗ 2026-06-09 support-desk).
 * Источник: GET /api/v1/support/my-tickets.
 */

import useSWR, { type KeyedMutator } from 'swr';

import { supportApi } from '@/api/support.api';
import {
  toSupportTicketListItem,
  type SupportTicketListItem,
} from '@/domain/support';

export interface UseMyTicketsResult {
  data: SupportTicketListItem[] | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<SupportTicketListItem[]>;
}

export function useMyTickets(): UseMyTicketsResult {
  const { data, error, isLoading, mutate } = useSWR(
    'support-my-tickets',
    () =>
      supportApi
        .listMyTickets()
        .then((res) => res.items.map(toSupportTicketListItem)),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
