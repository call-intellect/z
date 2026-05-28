'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { projectDocumentsApi } from '@/api/tracker/project-documents.api';
import { linkedCardFromApi, type LinkedCard } from '@/domain/tracker';

/**
 * Связанные CRM-карточки проекта (через подвязанные ко встречам задачи).
 * SWR-ключ: `['tracker.project.linked-cards', orgId, projectId]`.
 *
 * Бэк инкрементирует `linked_cards_view_total{tenant,project}` на каждый вызов,
 * поэтому хук должен использоваться только при разворачивании блока — не
 * запрашиваем при mount, если блок свёрнут (передаётся `enabled=false`).
 */
export function useProjectLinkedCards(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
  enabled: boolean,
): {
  cards: LinkedCard[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    enabled && orgId && projectId
      ? ['tracker.project.linked-cards', orgId, projectId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return projectDocumentsApi.linkedCards(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  const cards = useMemo<LinkedCard[]>(
    () => (swr.data ? swr.data.map(linkedCardFromApi) : []),
    [swr.data],
  );

  return {
    cards,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
