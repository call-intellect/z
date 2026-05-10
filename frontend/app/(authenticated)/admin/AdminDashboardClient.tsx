'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, Users as UsersIcon, Activity } from 'lucide-react';

import { adminUsageApi } from '@/api/admin-usage.api';
import {
  ADMIN_PERIOD_LABELS,
  adminDashboardFromApi,
  formatUsd,
  type AdminPeriod,
} from '@/domain/admin-usage';
import { taskTypeLabel } from '@/domain/admin-experiment';
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
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from './AdminStateViews';
import { useAdminQuery } from './useAdminQuery';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];

export function AdminDashboardClient() {
  const [period, setPeriod] = useState<AdminPeriod>('week');

  const q = useAdminQuery(
    `admin-dashboard:${period}`,
    async () => {
      const res = await adminUsageApi.getDashboard({ period });
      return adminDashboardFromApi(res);
    },
    [period],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Глобальный дашборд</h1>
          <p className="text-sm text-fg-tertiary">
            Расход LLM по всем Org за выбранный период.
          </p>
        </div>
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as AdminPeriod)}
        >
          <SelectTrigger className="w-[180px]">
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
      </div>

      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.isForbidden && !q.error && q.data && (
        <DashboardContent data={q.data} />
      )}
    </div>
  );
}

function DashboardContent({
  data,
}: {
  data: ReturnType<typeof adminDashboardFromApi>;
}) {
  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          title="Расход за период"
          value={formatUsd(data.totals.totalCostUsd)}
          subtitle={`${data.totals.totalCalls.toLocaleString('ru-RU')} вызовов`}
        />
        <KpiTile
          title="Доля ошибок"
          value={`${(data.totals.failRate * 100).toFixed(1)}%`}
          subtitle={`${data.totals.failedCalls.toLocaleString('ru-RU')} fail'ов`}
          tone={data.totals.failRate > 0.05 ? 'warning' : 'default'}
        />
        {data.counts && (
          <>
            <KpiTile
              title="Орг и юзеров"
              value={`${data.counts.orgsTotal} / ${data.counts.usersTotal}`}
              subtitle={`Active 7d: ${data.counts.activeUsers7d}`}
              icon={<Building2 size={18} />}
            />
            <KpiTile
              title="DAU 7d"
              value={`${data.counts.activeUsers7d}`}
              subtitle="уникальных пользователей"
              icon={<UsersIcon size={18} />}
            />
          </>
        )}
      </div>

      {/* By provider */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Расход по провайдерам</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byProvider.length === 0 ? (
            <AdminEmpty
              title="Нет данных"
              description="За выбранный период ни одного LLM-вызова не зафиксировано."
            />
          ) : (
            <ul className="space-y-2">
              {data.byProvider.map((p) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs">{p.provider}</span>
                  <div className="flex items-center gap-4 text-fg-tertiary">
                    <span>{p.calls.toLocaleString('ru-RU')} вызовов</span>
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

      {/* By taskType */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Топ функций по расходу</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/usage/functions">
              Все функции <ArrowRight size={12} />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.byTaskType.length === 0 ? (
            <AdminEmpty
              title="Нет данных"
              description="Функции LLM ещё не вызывались."
            />
          ) : (
            <ul className="space-y-2">
              {data.byTaskType.slice(0, 10).map((t) => (
                <li
                  key={t.taskType}
                  className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/usage/functions/${encodeURIComponent(t.taskType)}`}
                    className="flex flex-col gap-0.5 hover:text-accent"
                  >
                    <span>{taskTypeLabel(t.taskType)}</span>
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      {t.taskType}
                    </span>
                  </Link>
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

      {/* Top orgs (только для global) */}
      {data.topOrgs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Топ организаций по расходу</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/orgs">
                Все Org <ArrowRight size={12} />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.topOrgs.map((o) => (
                <li
                  key={o.tenantId}
                  className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
                >
                  <span>{o.name}</span>
                  <div className="flex items-center gap-4 text-fg-tertiary">
                    <span>{o.calls.toLocaleString('ru-RU')}</span>
                    <span className="font-medium text-fg-primary">
                      {formatUsd(o.costUsd)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-fg-tertiary">
        <Activity size={11} className="mr-1 inline" />
        Метрики кэшируются на 60 секунд.
      </p>
    </div>
  );
}

function KpiTile({
  title,
  value,
  subtitle,
  tone = 'default',
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: 'default' | 'warning';
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-fg-tertiary">
          <span>{title}</span>
          {icon}
        </div>
        <div
          className={`text-2xl font-semibold ${
            tone === 'warning' ? 'text-warning' : ''
          }`}
        >
          {value}
        </div>
        {subtitle && (
          <div className="mt-1 text-xs text-fg-tertiary">{subtitle}</div>
        )}
      </CardContent>
    </Card>
  );
}
