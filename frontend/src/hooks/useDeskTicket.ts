'use client';

/**
 * `useDeskTicket(id)` — детали тикета деска + ВСЕ сообщения (internal+external)
 * (ТЗ 2026-06-09 support-desk). Источник: GET /api/v1/support/desk/tickets/:id.
 * Ключ null при пустом id или когда хук выключен.
 */

import useSWR, { type KeyedMutator } from 'swr';

import { supportApi } from '@/api/support.api';
import { toDeskTicketDetail, type DeskTicketDetail } from '@/domain/support';

export interface UseDeskTicketResult {
  data: DeskTicketDetail | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<DeskTicketDetail>;
}

export function useDeskTicket(
  id: string | null | undefined,
  enabled = true,
): UseDeskTicketResult {
  const { data, error, isLoading, mutate } = useSWR(
    id && enabled ? ['support-desk-ticket', id] : null,
    () => supportApi.getDeskTicket(id as string).then(toDeskTicketDetail),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
