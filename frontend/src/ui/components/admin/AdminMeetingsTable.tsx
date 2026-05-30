'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { MEETING_STATUSES, MEETING_TYPES, type MeetingStatus, type MeetingType } from '@/domain/enums';
import { Button } from '@/ui/components/shared/Button';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { t } from '@/lib/i18n';

const PAGE_SIZE = 20;

export function AdminMeetingsTable() {
  const [status, setStatus] = useState<MeetingStatus | ''>('');
  const [type, setType] = useState<MeetingType | ''>('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);

  const { data, error, isLoading, mutate } = useSWR(
    ['admin:meetings', status, type, ownerId, page],
    () =>
      adminApi.listMeetings({
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(ownerId ? { owner_id: ownerId } : {}),
        page,
        limit: PAGE_SIZE,
      }),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg-primary">{t('admin.meetings.title')}</h1>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border-subtle bg-bg-card p-3">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          <span>{t('admin.meetings.filter_status')}</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as MeetingStatus | '');
              setPage(1);
            }}
            className="rounded-md border border-border px-2 py-1.5 text-sm"
          >
            <option value="">{t('admin.meetings.filter_all')}</option>
            {MEETING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          <span>{t('admin.meetings.filter_type')}</span>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as MeetingType | '');
              setPage(1);
            }}
            className="rounded-md border border-border px-2 py-1.5 text-sm"
          >
            <option value="">{t('admin.meetings.filter_all')}</option>
            {MEETING_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          <span>{t('admin.meetings.filter_owner')}</span>
          <input
            type="text"
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value.trim());
              setPage(1);
            }}
            className="rounded-md border border-border px-2 py-1.5 text-sm"
            placeholder="user-id"
          />
        </label>
      </div>

      {error ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : t('errors.unknown')}
          onRetry={() => mutate()}
        />
      ) : isLoading ? (
        <div className="space-y-2 rounded-md border border-border-subtle bg-bg-card p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('meetings.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle bg-bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-3 py-2">{t('admin.meetings.th_id')}</th>
                <th className="px-3 py-2">{t('admin.meetings.th_title')}</th>
                <th className="px-3 py-2">{t('admin.meetings.th_type')}</th>
                <th className="px-3 py-2">{t('admin.meetings.th_status')}</th>
                <th className="px-3 py-2">{t('admin.meetings.th_owner')}</th>
                <th className="px-3 py-2">{t('admin.meetings.th_created')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr key={m.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-mono text-xs text-fg-secondary">{m.id}</td>
                  <td className="px-3 py-2 text-fg-primary">{m.title}</td>
                  <td className="px-3 py-2 text-fg-secondary">{m.type}</td>
                  <td className="px-3 py-2 text-fg-secondary">{m.status}</td>
                  <td className="px-3 py-2 text-fg-secondary">{m.ownerEmail}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {new Date(m.createdAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/media/meetings/${encodeURIComponent(m.id)}`}
                      className="text-info hover:underline"
                    >
                      {t('admin.meetings.details')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex items-center justify-between">
        <span className="text-sm text-fg-secondary">
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
