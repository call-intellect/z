'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { labelsApi, type ListLabelsRequest } from '@/api/tracker/labels.api';
import { labelFromApi, type Label } from '@/domain/tracker';

export function useLabels(
  orgId: string | null | undefined,
  req: ListLabelsRequest = {},
): {
  labels: Label[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ['tracker.labels', orgId, req.projectId ?? null] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return labelsApi.list(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  const labels = useMemo<Label[]>(
    () => (swr.data ? swr.data.map(labelFromApi) : []),
    [swr.data],
  );

  return {
    labels,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
