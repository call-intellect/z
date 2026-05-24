'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { intakeApi, type ListIntakeRequest } from '@/api/tracker/intake.api';
import { intakeFromApi, type Intake } from '@/domain/tracker';

export function useIntake(
  orgId: string | null | undefined,
  req: ListIntakeRequest = {},
): {
  intake: Intake[];
  total: number;
  page: number;
  limit: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? [
        'tracker.intake',
        orgId,
        req.status ?? null,
        req.source ?? null,
        req.projectId ?? null,
        req.page ?? 1,
        req.limit ?? 50,
      ]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return intakeApi.list(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  const intake = useMemo<Intake[]>(
    () => (swr.data?.items ? swr.data.items.map(intakeFromApi) : []),
    [swr.data],
  );

  return {
    intake,
    total: swr.data?.total ?? 0,
    page: swr.data?.page ?? 1,
    limit: swr.data?.limit ?? 50,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
