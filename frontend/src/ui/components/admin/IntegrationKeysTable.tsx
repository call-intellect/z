'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { adminApi, type IntegrationKeyApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { toast } from 'sonner';
import { Button } from '@/ui/components/shared/Button';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { t } from '@/lib/i18n';

import { CreateKeyModal } from './CreateKeyModal';
import { RevokeKeyConfirm } from './RevokeKeyConfirm';

export function IntegrationKeysTable() {
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<IntegrationKeyApi | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    'admin:integration-keys',
    () => adminApi.listKeys(),
    { revalidateOnFocus: false },
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      try {
        await adminApi.revokeKey(id);
        toast.success(t('admin.integration_keys.status_revoked'));
        await mutate();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : t('errors.unknown'));
      }
    },
    [mutate],
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          {t('admin.integration_keys.title')}
        </h1>
        <Button onClick={() => setCreateOpen(true)}>
          {t('admin.integration_keys.create')}
        </Button>
      </header>

      {error ? (
        <ErrorState
          message={
            error instanceof ApiError ? error.message : t('errors.unknown')
          }
          onRetry={() => mutate()}
        />
      ) : isLoading ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('admin.integration_keys.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">{t('admin.integration_keys.th_partner')}</th>
                <th className="px-3 py-2">{t('admin.integration_keys.th_created')}</th>
                <th className="px-3 py-2">{t('admin.integration_keys.th_status')}</th>
                <th className="px-3 py-2">{t('admin.integration_keys.th_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-900">{k.partnerName}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {new Date(k.createdAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-2">
                    {k.revokedAt ? (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                        {t('admin.integration_keys.status_revoked')}
                      </span>
                    ) : (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                        {t('admin.integration_keys.status_active')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!k.revokedAt ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRevokeTarget(k)}
                      >
                        {t('admin.integration_keys.revoke')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateKeyModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          void mutate();
        }}
      />

      <RevokeKeyConfirm
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={async (id) => {
          setRevokeTarget(null);
          await handleRevoke(id);
        }}
      />
    </section>
  );
}
