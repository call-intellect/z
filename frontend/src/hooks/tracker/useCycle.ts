'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { cyclesApi } from '@/api/tracker/cycles.api';
import {
  cycleFromApi,
  issueFromApi,
  type Cycle,
  type Issue,
} from '@/domain/tracker';

export function useCycle(
  orgId: string | null | undefined,
  cycleId: string | null | undefined,
): {
  cycle: Cycle | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId && cycleId ? ['tracker.cycle', orgId, cycleId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !cycleId) throw new Error('orgId/cycleId required');
      return cyclesApi.get(orgId, cycleId);
    },
    { revalidateOnFocus: false },
  );

  const cycle = useMemo<Cycle | null>(
    () => (swr.data ? cycleFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    cycle,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}

export function useCycleIssues(
  orgId: string | null | undefined,
  cycleId: string | null | undefined,
): {
  issues: Issue[];
  total: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && cycleId ? ['tracker.cycle.issues', orgId, cycleId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !cycleId) throw new Error('orgId/cycleId required');
      return cyclesApi.issues(orgId, cycleId);
    },
    { revalidateOnFocus: false },
  );

  const issues = useMemo<Issue[]>(
    () => (swr.data?.items ? swr.data.items.map(issueFromApi) : []),
    [swr.data],
  );

  return {
    issues,
    total: swr.data?.total ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
