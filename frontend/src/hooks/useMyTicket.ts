'use client';

/**
 * `useMyTicket(id)` — детали моего обращения + лента видимых сообщений
 * (ТЗ 2026-06-09 support-desk). Источник: GET /api/v1/support/my-tickets/:id.
 * Ключ null при пустом id (хук не дёргает API).
 */

import useSWR, { type KeyedMutator } from 'swr';

import { supportApi } from '@/api/support.api';
import {
  toSupportTicketDetail,
  type SupportTicketDetail,
} from '@/domain/support';

export interface UseMyTicketResult {
  data: SupportTicketDetail | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<SupportTicketDetail>;
}

export function useMyTicket(id: string | null | undefined): UseMyTicketResult {
  const { data, error, isLoading, mutate } = useSWR(
    id ? ['support-my-ticket', id] : null,
    () => supportApi.getMyTicket(id as string).then(toSupportTicketDetail),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
