'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';

import { meetingsApi } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { meetingSummaryFromApi } from '@/domain/meeting';
import type { MeetingStatus, MeetingType } from '@/domain/enums';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';

import { MeetingFiltersBar } from './MeetingFiltersBar';
import { MeetingRow } from './MeetingRow';

const PAGE_SIZE = 20;

export function MeetingsTable() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [type, setType] = useState<MeetingType | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ['meetings-list', page, status ?? '', type ?? ''],
    async () =>
      meetingsApi.list({
        page,
        limit: PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
      }),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const items = data ? data.items.map(meetingSummaryFromApi) : [];

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t('meetings.list')}</h1>
        <Link
          href="/meetings/create"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('meetings.create')}
        </Link>
      </header>
      <MeetingFiltersBar
        status={status}
        type={type}
        onStatusChange={(s) => {
          setStatus(s);
          setPage(1);
        }}
        onTypeChange={(tt) => {
          setType(tt);
          setPage(1);
        }}
      />

      {error ? (
        <ErrorState
          message={
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : t('errors.unknown')
          }
          onRetry={() => mutate()}
        />
      ) : isLoading ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('meetings.empty')}
          description={t('app.tagline')}
          action={
            <Link
              href="/meetings/create"
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('meetings.create')}
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">{t('meetings.type_label')}</th>
                <th className="px-3 py-2">{t('meetings.title_label')}</th>
                <th className="px-3 py-2">{t('meetings.date_label')}</th>
                <th className="px-3 py-2">{t('meetings.duration')}</th>
                <th className="px-3 py-2">{t('meetings.status_label')}</th>
                <th className="px-3 py-2">{t('meetings.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <MeetingRow key={m.id} meeting={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex items-center justify-between">
        <span className="text-sm text-slate-600">
          {data ? `${page} ${t('meetings.pagination_of')} ${totalPages}` : ''}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t('meetings.pagination_prev')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t('meetings.pagination_next')}
          </Button>
        </div>
      </footer>
    </section>
  );
}
