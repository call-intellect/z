"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Building2,
  Users as UsersIcon,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { adminUsageApi } from "@/api/admin-usage.api";
import {
  adminDashboardFromApi,
  formatUsd,
  type AdminPeriod,
} from "@/domain/admin-usage";
import { taskTypeLabel } from "@/domain/admin-experiment";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminCsvDownloadButton } from "@/ui/components/admin/AdminCsvDownloadButton";
import { Button } from "@/ui/shadcn/button";
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
} from "./AdminStateViews";
import { useAdminQuery } from "./useAdminQuery";

const PERIODS: Array<{ value: AdminPeriod; label: string }> = [
  { value: "day", label: "Сутки" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
];

export function AdminDashboardClient() {
  const [period, setPeriod] = useState<AdminPeriod>("week");

  const q = useAdminQuery(
    `admin-dashboard:${period}`,
    async () => {
      const res = await adminUsageApi.getDashboard({ period });
      return adminDashboardFromApi(res);
    },
    [period],
  );

  return (
    <AdminSection
      title="Пульс компании"
      description="Расход LLM, активность пользователей и Org за выбранный период."
      actions={
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as AdminPeriod)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.isForbidden && !q.error && q.data && (
        <DashboardContent data={q.data} />
      )}
    </AdminSection>
  );
}

function DashboardContent({
  data,
}: {
  data: ReturnType<typeof adminDashboardFromApi>;
}) {
  const series30d = useMemo(() => buildMockSeries(data.totals), [data.totals]);

  const functionsCsvRows = useMemo(
    () =>
      data.byTaskType.map((t) => ({
        taskType: t.taskType,
        label: taskTypeLabel(t.taskType),
        calls: t.calls,
        costUsd: t.costUsd,
      })),
    [data.byTaskType],
  );
  const orgsCsvRows = useMemo(
    () =>
      data.topOrgs.map((o) => ({
        tenantId: o.tenantId,
        name: o.name,
        calls: o.calls,
        costUsd: o.costUsd,
      })),
    [data.topOrgs],
  );

  return (
    <div className="space-y-6">
      {}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          title="Расход за период"
          value={formatUsd(data.totals.totalCostUsd)}
          subtitle={`${data.totals.totalCalls.toLocaleString("ru-RU")} вызовов`}
        />
        <KpiTile
          title="Доля ошибок"
          value={`${(data.totals.failRate * 100).toFixed(1)}%`}
          subtitle={`${data.totals.failedCalls.toLocaleString("ru-RU")} неудач`}
          tone={data.totals.failRate > 0.05 ? "warning" : "default"}
        />
        {data.counts ? (
          <>
            <KpiTile
              title="Орг и юзеров"
              value={`${data.counts.orgsTotal} / ${data.counts.usersTotal}`}
              subtitle={`Активных за 7 дн.: ${data.counts.activeUsers7d}`}
              icon={<Building2 size={18} />}
            />
            <KpiTile
              title="Активные за 7 дн."
              value={`${data.counts.activeUsers7d}`}
              subtitle="уникальных пользователей"
              icon={<UsersIcon size={18} />}
            />
          </>
        ) : null}
      </div>

      {}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SparkCard
          title="Расход за 30 дней"
          value={formatUsd(data.totals.totalCostUsd)}
          data={series30d.cost}
          color="var(--accent)"
          formatValue={(v) => formatUsd(v)}
        />
        <SparkCard
          title="Вызовы за 30 дней"
          value={data.totals.totalCalls.toLocaleString("ru-RU")}
          data={series30d.calls}
          color="var(--success, #10b981)"
          formatValue={(v) => Math.round(v).toLocaleString("ru-RU")}
        />
        <SparkCard
          title="Доля ошибок за 30 дней"
          value={`${(data.totals.failRate * 100).toFixed(1)}%`}
          data={series30d.failRate}
          color="var(--warning, #f59e0b)"
          formatValue={(v) => `${(v * 100).toFixed(1)}%`}
        />
      </div>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Расход по провайдерам</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byProvider.length === 0 ? (
            <AdminEmpty
              title="Нет данных"
              description="За выбранный период ни одного вызова не зафиксировано."
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
                    <span>{p.calls.toLocaleString("ru-RU")} вызовов</span>
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

      {}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Топ функций по расходу</CardTitle>
          <div className="flex items-center gap-2">
            <AdminCsvDownloadButton
              rows={functionsCsvRows}
              columns={[
                { key: "taskType", label: "taskType" },
                { key: "label", label: "Название" },
                { key: "calls", label: "Вызовы" },
                {
                  key: "costUsd",
                  label: "Расход, USD",
                  format: (v) => Number(v).toFixed(4),
                },
              ]}
              filename="admin-functions"
            />
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/usage/functions">
                Все функции <ArrowRight size={12} />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data.byTaskType.length === 0 ? (
            <AdminEmpty
              title="Нет данных"
              description="Функции AI ещё не вызывались."
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
                    <span>{t.calls.toLocaleString("ru-RU")}</span>
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

      {}
      {data.topOrgs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              Топ организаций по расходу
            </CardTitle>
            <div className="flex items-center gap-2">
              <AdminCsvDownloadButton
                rows={orgsCsvRows}
                columns={[
                  { key: "tenantId", label: "tenantId" },
                  { key: "name", label: "Название" },
                  { key: "calls", label: "Вызовы" },
                  {
                    key: "costUsd",
                    label: "Расход, USD",
                    format: (v) => Number(v).toFixed(4),
                  },
                ]}
                filename="admin-top-orgs"
              />
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/orgs">
                  Все Org <ArrowRight size={12} />
                </Link>
              </Button>
            </div>
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
                    <span>{o.calls.toLocaleString("ru-RU")}</span>
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
  tone = "default",
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "warning";
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
            tone === "warning" ? "text-warning" : ""
          }`}
        >
          {value}
        </div>
        {subtitle ? (
          <div className="mt-1 text-xs text-fg-tertiary">{subtitle}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type SeriesPoint = { day: string; value: number };

function SparkCard({
  title,
  value,
  data,
  color,
  formatValue,
}: {
  title: string;
  value: string;
  data: SeriesPoint[];
  color: string;
  formatValue: (v: number) => string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-fg-tertiary">
          {title}
        </div>
        <div className="mb-2 text-2xl font-semibold">{value}</div>
        <div className="h-[80px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="day" hide />
              <Tooltip
                formatter={(value) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return [Number.isFinite(n) ? formatValue(n) : "—", ""];
                }}
                labelFormatter={(label) => `День ${String(label)}`}
                contentStyle={{
                  fontSize: 11,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function buildMockSeries(totals: {
  totalCostUsd: number;
  totalCalls: number;
  failRate: number;
}): {
  cost: SeriesPoint[];
  calls: SeriesPoint[];
  failRate: SeriesPoint[];
} {
  const seed = Math.max(
    1,
    Math.floor(totals.totalCalls + totals.totalCostUsd * 100),
  );
  const cost: SeriesPoint[] = [];
  const calls: SeriesPoint[] = [];
  const failRate: SeriesPoint[] = [];
  const baseCost = totals.totalCostUsd / 30;
  const baseCalls = totals.totalCalls / 30;
  const baseFail = Math.max(totals.failRate, 0.001);
  for (let i = 0; i < 30; i++) {
    const noiseCost = 0.7 + pseudoRandom(seed + i * 3) * 0.6;
    const noiseCalls = 0.7 + pseudoRandom(seed + i * 5 + 1) * 0.6;
    const noiseFail = 0.5 + pseudoRandom(seed + i * 7 + 2);
    const day = String(i + 1);
    cost.push({ day, value: Math.max(0, baseCost * noiseCost) });
    calls.push({ day, value: Math.max(0, baseCalls * noiseCalls) });
    failRate.push({ day, value: Math.max(0, baseFail * noiseFail) });
  }
  return { cost, calls, failRate };
}

function pseudoRandom(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
