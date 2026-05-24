'use client';

import { orgEconomicsApi } from '@/api/admin-economics.api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

/**
 * SBA α-10 wave 3 — /admin/org/economics.
 * Для admin'ов СВОЕЙ Org (org_admin/owner, не super_admin).
 */
export function OrgEconomicsCurrentClient() {
  const q = useAdminQuery(
    'org-economics:current',
    () => orgEconomicsApi.current({ days: 30 }),
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Юнит-экономика организации</h1>
        <p className="text-sm text-fg-tertiary">
          Затраты AI за 30 дней и текущий месяц.
        </p>
      </div>

      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.callsCountLast30d === 0 && (
        <AdminEmpty
          title="Нет AI-вызовов за 30 дней"
          description="Затраты появятся после первой AI-операции в Org."
        />
      )}
      {!q.isLoading && q.data && q.data.callsCountLast30d > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Stat
              title="За 30 дней, ₽"
              value={q.data.costRubLast30d.toLocaleString('ru-RU')}
            />
            <Stat
              title="Этот месяц, ₽"
              value={Math.round(q.data.costRubMonthToDate).toLocaleString(
                'ru-RU',
              )}
            />
            <Stat
              title="Вызовов 30d"
              value={q.data.callsCountLast30d.toLocaleString('ru-RU')}
            />
            <Stat
              title="Средний ₽/user"
              value={Math.round(q.data.avgCostPerUserRub).toLocaleString(
                'ru-RU',
              )}
            />
          </div>

          {q.data.budget && q.data.budget.utilizationPercent != null && (
            <Card>
              <CardHeader>
                <CardTitle>Бюджет на месяц</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-semibold tabular-nums">
                    {q.data.budget.utilizationPercent.toFixed(1)}%
                  </div>
                  <div className="h-2 rounded bg-bg-overlay">
                    <div
                      className={
                        q.data.budget.utilizationPercent >= 100
                          ? 'h-full rounded bg-danger'
                          : q.data.budget.utilizationPercent >= 80
                            ? 'h-full rounded bg-warning'
                            : 'h-full rounded bg-accent'
                      }
                      style={{
                        width: `${Math.min(100, q.data.budget.utilizationPercent)}%`,
                      }}
                    />
                  </div>
                  <div className="text-xs text-fg-tertiary">
                    Лимит: {q.data.budget.monthlyCapRub?.toLocaleString('ru-RU')}{' '}
                    ₽ ({q.data.budget.capKind})
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-fg-tertiary">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
