'use client';

/**
 * SWR-хук для данных онбординга Org (setup-прогресс).
 * ТЗ 2026-05-29 onboarding-v2.
 */

import useSWR from 'swr';
import { orgsApi, type OrgApi } from '@/api/orgs.api';

export function useOrgSetup(orgId: string | null) {
  const swr = useSWR<{ org: OrgApi }>(
    orgId ? ['orgs.setup', orgId] : null,
    () => orgsApi.byId(orgId!),
    { revalidateOnFocus: false },
  );

  const org = swr.data?.org ?? null;

  return {
    org,
    setupCompletedAt: org?.setupCompletedAt ?? null,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
