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
        <h1 className="text-2xl font-semibold text-slate-900">{t('admin.expiring.title')}</h1>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          <span>{t('admin.expiring.within_hours')}</span>
          <input
            type="number"
            min={1}
            max={720}
            value={withinHours}
            onChange={(e) => setWithinHours(Math.max(1, Number(e.target.value) || 48))}
            className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
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
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('admin.expiring.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
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
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <a
                      href={`/admin/meetings/${encodeURIComponent(row.meetingId)}`}
                      className="text-blue-700 hover:underline"
                    >
                      {row.meetingTitle}
                    </a>
                    <div className="font-mono text-xs text-slate-500">{row.meetingId}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.status}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {new Date(row.expiresAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.retentionDays}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {row.durationSeconds !== null ? `${row.durationSeconds} s` : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.bytesTotal ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
