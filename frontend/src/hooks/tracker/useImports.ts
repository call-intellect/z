'use client';

/**
 * useImports — список импортов организации (Wave 3 / Tracker Phase 5 part 1).
 *
 * Backend контракт: `GET /api/v1/tracker/imports?limit&cursor&source&status`.
 * SWR ключ: `['tracker.imports', orgId, source, status, limit, cursor]`.
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { importsApi, type ListImportsRequest } from '@/api/tracker/imports.api';
import { importLogFromApi, type ImportLog } from '@/domain/tracker';

export interface UseImportsResult {
  imports: ImportLog[];
  nextCursor: string | null;
  limit: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

export function useImports(
  orgId: string | null | undefined,
  req: ListImportsRequest = {},
): UseImportsResult {
  const key = orgId
    ? ([
        'tracker.imports',
        orgId,
        req.source ?? null,
        req.status ?? null,
        req.limit ?? 20,
        req.cursor ?? null,
      ] as const)
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return importsApi.list(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  const imports = useMemo<ImportLog[]>(
    () => (swr.data?.items ?? []).map(importLogFromApi),
    [swr.data],
  );

  return {
    imports,
    nextCursor: swr.data?.nextCursor ?? null,
    limit: swr.data?.limit ?? (req.limit ?? 20),
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
