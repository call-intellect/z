'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { Button } from '@/ui/components/shared/Button';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { t } from '@/lib/i18n';

export function ExpiringRecordingsTable() {
  const [withinHours, setWithinHours] = useState(48);
  const [applied, setApplied] = useState(48);

  const { data, error, isLoading, mutate } = useSWR(
    ['admin:expiring', applied],
    () => adminApi.expiringRecordings(applied),
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg-primary">{t('admin.expiring.title')}</h1>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border-subtle bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          <span>{t('admin.expiring.within_hours')}</span>
          <input
            type="number"
            min={1}
            max={720}
            value={withinHours}
            onChange={(e) => setWithinHours(Math.max(1, Number(e.target.value) || 48))}
            className="w-32 rounded-md border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <Button size="sm" onClick={() => setApplied(withinHours)}>
          {t('admin.expiring.apply')}
        </Button>
      </div>

      {error ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : t('errors.unknown')}
          onRetry={() => mutate()}
        />
      ) : isLoading ? (
        <div className="space-y-2 rounded-md border border-border-subtle bg-white p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('admin.expiring.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-3 py-2">{t('admin.expiring.th_meeting')}</th>
                <th className="px-3 py-2">{t('admin.expiring.th_status')}</th>
                <th className="px-3 py-2">{t('admin.expiring.th_expires_at')}</th>
                <th className="px-3 py-2">{t('admin.expiring.th_retention')}</th>
                <th className="px-3 py-2">{t('admin.expiring.th_duration')}</th>
                <th className="px-3 py-2">{t('admin.expiring.th_size')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2">
                    <a
                      href={`/admin/meetings/${encodeURIComponent(row.meetingId)}`}
                      className="text-info hover:underline"
                    >
                      {row.meetingTitle}
                    </a>
                    <div className="font-mono text-xs text-fg-secondary">{row.meetingId}</div>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{row.status}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {new Date(row.expiresAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{row.retentionDays}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {row.durationSeconds !== null ? `${row.durationSeconds} s` : '—'}
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{row.bytesTotal ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
