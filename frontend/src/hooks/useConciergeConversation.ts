"use client";

import useSWR, { type KeyedMutator } from "swr";

import { conciergeApi } from "@/api/concierge.api";
import {
  toConciergeConversationDetail,
  type ConciergeConversationDetail,
} from "@/domain/concierge-conversation";

export interface UseConciergeConversationResult {
  data: ConciergeConversationDetail | undefined;
  isLoading: boolean;
  error: unknown;
  mutate: KeyedMutator<ConciergeConversationDetail>;
}

export function useConciergeConversation(
  id: string | null,
): UseConciergeConversationResult {
  const { data, error, isLoading, mutate } = useSWR(
    id ? ["concierge-conversation", id] : null,
    () =>
      conciergeApi
        .getConversation(id as string)
        .then(toConciergeConversationDetail),
    { revalidateOnFocus: false },
  );

  return { data, isLoading, error, mutate };
}
