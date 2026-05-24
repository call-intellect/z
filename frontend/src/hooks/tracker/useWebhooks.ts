'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { webhooksApi } from '@/api/tracker/webhooks.api';
import { webhookFromApi, type Webhook } from '@/domain/tracker';

export function useWebhooks(orgId: string | null | undefined): {
  webhooks: Webhook[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ['tracker.webhooks', orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return webhooksApi.list(orgId);
    },
    { revalidateOnFocus: false },
  );

  const webhooks = useMemo<Webhook[]>(
    () => (swr.data ? swr.data.map(webhookFromApi) : []),
    [swr.data],
  );

  return {
    webhooks,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
