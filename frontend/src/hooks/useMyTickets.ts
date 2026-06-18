"use client";

import useSWR, { type KeyedMutator } from "swr";

import { supportApi } from "@/api/support.api";
import {
  toSupportTicketListItem,
  type SupportTicketListItem,
} from "@/domain/support";

export interface UseMyTicketsResult {
  data: SupportTicketListItem[] | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<SupportTicketListItem[]>;
}

export function useMyTickets(): UseMyTicketsResult {
  const { data, error, isLoading, mutate } = useSWR(
    "support-my-tickets",
    () =>
      supportApi
        .listMyTickets()
        .then((res) => res.items.map(toSupportTicketListItem)),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
