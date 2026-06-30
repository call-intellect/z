"use client";

import useSWR, { type KeyedMutator } from "swr";

import { conciergeApi } from "@/api/concierge.api";
import {
  toConciergeConversationListItem,
  type ConciergeConversationListItem,
} from "@/domain/concierge-conversation";

export interface UseConciergeConversationsResult {
  data: ConciergeConversationListItem[] | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<ConciergeConversationListItem[]>;
}

export function useConciergeConversations(
  enabled = true,
  archived = false,
): UseConciergeConversationsResult {
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ["concierge-conversations", archived] : null,
    () =>
      conciergeApi
        .listConversations(archived, 1, 50)
        .then((res) => res.items.map(toConciergeConversationListItem)),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
