'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { orgAdminUsageApi } from '@/api/org-admin-usage.api';
import {
  ADMIN_PERIOD_LABELS,
  adminDashboardFromApi,
  formatUsd,
  type AdminPeriod,
} from '@/domain/admin-usage';
import { taskTypeLabel } from '@/domain/admin-experiment';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../../admin/AdminStateViews';
import { useCurrentOrgId } from '../useCurrentOrgId';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];

export function OrgUsageClient() {
  const { orgId, isLoading: orgLoading, error: orgError } = useCurrentOrgId();
  const [period, setPeriod] = useState<AdminPeriod>('week');
  const [data, setData] = useState<ReturnType<typeof adminDashboardFromApi> | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setError(null);
    setIsForbidden(false);
    try {
      const res = await orgAdminUsageApi.getDashboard(orgId, { period });
      setData(adminDashboardFromApi(res));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setIsForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId, period]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (orgLoading) {
    return <AdminLoading rows={3} />;
  }
  if (orgError) {
    return <AdminError message={orgError} />;
  }
  if (!orgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org. Попросите владельца пригласить вас."
      />
    );
  }
  const orgIdResolved: string = orgId;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Экономика организации</h1>
          <p className="text-sm text-fg-tertiary">
            Расход LLM в вашей Org за период.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as AdminPeriod)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {ADMIN_PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const url = orgAdminUsageApi.exportCsvUrl({ period, kind: 'calls' });
              // X-Org-Id обязателен — открываем через fetch + blob.
              void downloadCsv(url, orgIdResolved);
            }}
          >
            CSV
          </Button>
        </div>
      </div>

      {isLoading && <AdminLoading rows={5} />}
      {!isLoading && isForbidden && (
        <AdminForbidden
          description="Эта страница доступна только владельцу или администратору Org. Если вы — manager, обратитесь к owner."
        />
      )}
      {!isLoading && error && <AdminError message={error} onRetry={refetch} />}
      {!isLoading && data && <DashboardContent data={data} />}
    </div>
  );
}

async function downloadCsv(url: string, orgId: string) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'X-Org-Id': orgId },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `usage-org-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch {
    // ignore
  }
}

function DashboardContent({
  data,
}: {
  data: ReturnType<typeof adminDashboardFromApi>;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-fg-tertiary">
              Расход
            </div>
            <div className="text-2xl font-semibold">
              {formatUsd(data.totals.totalCostUsd)}
            </div>
            <div className="mt-1 text-xs text-fg-tertiary">
              {data.totals.totalCalls.toLocaleString('ru-RU')} вызовов
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-fg-tertiary">
              Fail rate
            </div>
            <div
              className={`text-2xl font-semibold ${
                data.totals.failRate > 0.05 ? 'text-warning' : ''
              }`}
            >
              {(data.totals.failRate * 100).toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-fg-tertiary">
              {data.totals.failedCalls.toLocaleString('ru-RU')} ошибок
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-fg-tertiary">
              Период
            </div>
            <div className="text-sm">
              {data.period.from.toLocaleDateString('ru-RU')} —{' '}
              {data.period.to.toLocaleDateString('ru-RU')}
            </div>
            <Badge variant="secondary" className="mt-2 text-[10px]">
              org-scope
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Расход по провайдерам</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byProvider.length === 0 ? (
            <p className="text-sm text-fg-tertiary">Пока нет данных.</p>
          ) : (
            <ul className="space-y-2">
              {data.byProvider.map((p) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs">{p.provider}</span>
                  <div className="flex items-center gap-4 text-fg-tertiary">
                    <span>{p.calls.toLocaleString('ru-RU')}</span>
                    <span className="font-medium text-fg-primary">
                      {formatUsd(p.costUsd)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Топ функций</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byTaskType.length === 0 ? (
            <p className="text-sm text-fg-tertiary">Пока нет данных.</p>
          ) : (
            <ul className="space-y-2">
              {data.byTaskType.slice(0, 10).map((t) => (
                <li
                  key={t.taskType}
                  className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span>{taskTypeLabel(t.taskType)}</span>
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      {t.taskType}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-fg-tertiary">
                    <span>{t.calls.toLocaleString('ru-RU')}</span>
                    <span className="font-medium text-fg-primary">
                      {formatUsd(t.costUsd)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
