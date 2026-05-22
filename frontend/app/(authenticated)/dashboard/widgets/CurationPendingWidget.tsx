'use client';

import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { curationApi } from '@/api/curation.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Виджет «На проверке у меня» (SBA α-4 §6.4).
 *
 * Источник правды: `GET /api/v1/curation/queue?assignedToMe=true&status=pending&limit=0`.
 * `limit=0` — count-only режим, без выгрузки items (см. CurationService.listQueue).
 */
export function CurationPendingWidget() {
  const swr = useSWR(
    ['curation-pending-me'],
    async () =>
      curationApi.listQueue({
        assignedToMe: true,
        status: 'pending',
        limit: 0,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck size={16} className="text-accent" />
          На проверке у меня
        </CardTitle>
      </CardHeader>
      <CardContent>
        {swr.isLoading ? (
          <Skeleton className="h-12" />
        ) : (
          <div className="flex items-end justify-between">
            <div className="text-3xl font-semibold tabular-nums">
              {swr.data?.total ?? 0}
            </div>
            <Link
              href="/curation?assignedToMe=true"
              className="text-sm text-accent hover:underline"
            >
              Открыть очередь →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
