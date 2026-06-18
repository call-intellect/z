"use client";

import Link from "next/link";
import { useState } from "react";

import { adminEconomicsApi } from "@/api/admin-economics.api";
import type { AdminEconomicsGlobalApi } from "@/domain/admin-economics";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminCsvDownloadButton } from "@/ui/components/admin/AdminCsvDownloadButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

export function EconomicsAnalyticsClient() {
  const [days, setDays] = useState(30);
  const q = useAdminQuery(
    `admin-analytics-economics:${days}`,
    () => adminEconomicsApi.global({ days, topN: 10 }),
    [days],
  );

  return (
    <AdminSection
      title="Юнит-экономика"
      description="Глобальные затраты AI за период, топ организаций, разрез по типу задачи."
      actions={
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">За 7 дней</SelectItem>
            <SelectItem value="30">За 30 дней</SelectItem>
            <SelectItem value="90">За 90 дней</SelectItem>
          </SelectContent>
        </Select>
      }
    >
      <div className="space-y-6">
        {q.isLoading && <AdminLoading rows={4} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && q.data && (
          <EconomicsDashboard data={q.data} days={days} />
        )}
      </div>
    </AdminSection>
  );
}

function EconomicsDashboard({
  data,
  days,
}: {
  data: AdminEconomicsGlobalApi;
  days: number;
}) {
  if (data.totals.callsCount === 0) {
    return (
      <AdminEmpty
        title="Нет AI-вызовов за период"
        description="Подождите, пока AI-пайплайн запишет данные в AiUsageLog."
      />
    );
  }

  const topOrgsRows: Array<Record<string, unknown>> = data.topOrgs.map((o) => ({
    orgName: o.orgName,
    tenantId: o.tenantId,
    costRub: o.costRub,
    calls: o.calls,
  }));

  const taskTypeRows: Array<Record<string, unknown>> = data.byTaskType.map(
    (t) => ({
      taskType: t.taskType,
      costRub: t.costRub,
      calls: t.calls,
    }),
  );

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Топ организаций по затратам</CardTitle>
          <AdminCsvDownloadButton
            rows={topOrgsRows}
            columns={[
              { key: "orgName", label: "Org" },
              { key: "tenantId", label: "tenantId" },
              { key: "costRub", label: "Стоимость, ₽" },
              { key: "calls", label: "Вызовов" },
            ]}
            filename={`admin-economics-top-orgs-${days}d.csv`}
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                  <tr
                    key={o.tenantId}
                    className="border-t border-border-subtle"
                  >
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Разрез по типу задачи</CardTitle>
          <AdminCsvDownloadButton
            rows={taskTypeRows}
            columns={[
              { key: "taskType", label: "Тип задачи" },
              { key: "costRub", label: "Стоимость, ₽" },
              { key: "calls", label: "Вызовов" },
            ]}
            filename={`admin-economics-by-task-${days}d.csv`}
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                  <tr
                    key={t.taskType}
                    className="border-t border-border-subtle"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.taskType}
                    </td>
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
          </div>
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
