"use client";

import Link from "next/link";
import { useState } from "react";

import { adminEconomicsApi } from "@/api/admin-economics.api";
import type { AdminEconomicsGlobalApi } from "@/domain/admin-economics";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../AdminStateViews";
import { useAdminQuery } from "../useAdminQuery";

export function EconomicsClient() {
  const [days, setDays] = useState(30);
  const q = useAdminQuery(
    `admin-economics:${days}`,
    () => adminEconomicsApi.global({ days, topN: 10 }),
    [days],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Юнит-экономика</h1>
          <p className="text-sm text-fg-tertiary">
            Глобальные затраты AI за период, топ организаций, разрез по типу
            задачи.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded border border-border-subtle bg-bg-card px-2 py-1 text-sm"
        >
          <option value={7}>За 7 дней</option>
          <option value={30}>За 30 дней</option>
          <option value={90}>За 90 дней</option>
        </select>
      </div>

      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && <EconomicsDashboard data={q.data} />}
    </div>
  );
}

function EconomicsDashboard({ data }: { data: AdminEconomicsGlobalApi }) {
  if (data.totals.callsCount === 0) {
    return (
      <AdminEmpty
        title="Нет AI-вызовов за период"
        description="Подождите, пока AI-пайплайн запишет данные в AiUsageLog."
      />
    );
  }
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          title="Стоимость, USD"
          value={`$${data.totals.costUsd.toFixed(2)}`}
        />
        <SummaryCard
          title="Стоимость, RUB"
          value={`${data.totals.costRub.toLocaleString("ru-RU")} ₽`}
        />
        <SummaryCard
          title="Вызовов"
          value={data.totals.callsCount.toLocaleString("ru-RU")}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Топ организаций по затратам</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Org</th>
                <th className="px-3 py-2 text-right">Стоимость, ₽</th>
                <th className="px-3 py-2 text-right">Вызовов</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.topOrgs.map((o) => (
                <tr key={o.tenantId} className="border-t border-border-subtle">
                  <td className="px-3 py-2">{o.orgName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {o.costRub.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {o.calls.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/economics/orgs/${o.tenantId}`}
                      className="text-accent hover:underline"
                    >
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Разрез по типу задачи</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Тип задачи</th>
                <th className="px-3 py-2 text-right">Стоимость, ₽</th>
                <th className="px-3 py-2 text-right">Вызовов</th>
              </tr>
            </thead>
            <tbody>
              {data.byTaskType.map((t) => (
                <tr key={t.taskType} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-mono text-xs">{t.taskType}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.costRub.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.calls.toLocaleString("ru-RU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-fg-tertiary">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
