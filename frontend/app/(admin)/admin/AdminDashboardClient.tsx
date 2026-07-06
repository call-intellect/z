"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Building2,
  DollarSign,
  Users as UsersIcon,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { adminUsageApi } from "@/api/admin-usage.api";
import { adminOrgsApi } from "@/api/admin-orgs.api";
import {
  adminDashboardFromApi,
  formatUsd,
  type AdminPeriod,
} from "@/domain/admin-usage";
import { taskTypeLabel } from "@/domain/admin-experiment";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminCsvDownloadButton } from "@/ui/components/admin/AdminCsvDownloadButton";
import {
  MultiSelectCombobox,
  type MultiSelectOption,
} from "@/ui/components/admin/MultiSelectCombobox";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { BarTrend, GRAD } from "@/ui/components/dashboard/modern";

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
  { value: "custom", label: "Свой период" },
];

function csv(values: string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ru-RU");
}

export function AdminDashboardClient() {
  const [period, setPeriod] = useState<AdminPeriod>("week");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [orgIds, setOrgIds] = useState<string[]>([]);

  const isCustom = period === "custom";
  const hasCustomRange = isCustom && Boolean(dateFrom && dateTo);

  const optionsQ = useAdminQuery(
    `admin-dashboard-options:${period}:${dateFrom}:${dateTo}`,
    async () => {
      if (isCustom && !hasCustomRange) return null;
      const res = await adminUsageApi.getDashboard({
        period,
        ...(hasCustomRange ? { from: dateFrom, to: dateTo } : {}),
      });
      return adminDashboardFromApi(res);
    },
    [period, dateFrom, dateTo, isCustom, hasCustomRange],
  );

  const orgsQ = useAdminQuery(
    "admin-dashboard-orgs",
    async () => adminOrgsApi.list({ limit: 200 }),
    [],
  );

  const providerOptions: MultiSelectOption[] = [
    ...new Set((optionsQ.data?.byModel ?? []).map((m) => m.provider)),
  ]
    .sort()
    .map((p) => ({ value: p, label: p }));
  const modelOptions: MultiSelectOption[] = [
    ...new Set(
      (optionsQ.data?.byModel ?? [])
        .filter((m) => providers.length === 0 || providers.includes(m.provider))
        .map((m) => m.model),
    ),
  ]
    .sort()
    .map((m) => ({ value: m, label: m }));
  const taskTypeOptions: MultiSelectOption[] = [
    ...new Set((optionsQ.data?.byTaskType ?? []).map((t) => t.taskType)),
  ]
    .sort()
    .map((t) => ({ value: t, label: taskTypeLabel(t) }));
  const orgOptions: MultiSelectOption[] = (orgsQ.data?.items ?? []).map((o) => ({
    value: o.id,
    label: o.name,
  }));

  const q = useAdminQuery(
    `admin-dashboard:${period}:${dateFrom}:${dateTo}:${providers.join(",")}:${models.join(",")}:${taskTypes.join(",")}:${orgIds.join(",")}`,
    async () => {
      if (isCustom && !hasCustomRange) return null;
      const res = await adminUsageApi.getDashboard({
        period,
        ...(hasCustomRange ? { from: dateFrom, to: dateTo } : {}),
        ...(csv(providers) ? { provider: csv(providers) } : {}),
        ...(csv(models) ? { model: csv(models) } : {}),
        ...(csv(taskTypes) ? { taskType: csv(taskTypes) } : {}),
        ...(csv(orgIds) ? { orgId: csv(orgIds) } : {}),
      });
      return adminDashboardFromApi(res);
    },
    [period, dateFrom, dateTo, providers, models, taskTypes, orgIds, isCustom, hasCustomRange],
  );

  const hasFilters = Boolean(
    dateFrom ||
      dateTo ||
      providers.length ||
      models.length ||
      taskTypes.length ||
      orgIds.length,
  );

  const resolvedRangeLabel = q.data
    ? `${formatDate(q.data.period.from)} – ${formatDate(q.data.period.to)}`
    : null;

  return (
    <AdminSection
      title="Пульс компании"
      description="Расход LLM, активность пользователей и Org за выбранный период."
      actions={
        <div className="flex items-center gap-2">
          {resolvedRangeLabel && (
            <span className="whitespace-nowrap rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-xs text-fg-tertiary">
              {resolvedRangeLabel}
            </span>
          )}
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
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-bg-card p-3">
          {isCustom && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-fg-tertiary">Дата от</span>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-fg-tertiary">Дата до</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 w-40"
                />
              </div>
            </>
          )}
          <MultiSelectCombobox
            label="Провайдер"
            placeholder="Все провайдеры"
            searchPlaceholder="Поиск провайдера…"
            className="w-48"
            options={providerOptions}
            selected={providers}
            onChange={(next) => {
              setProviders(next);
              const allowedModels = new Set(
                (optionsQ.data?.byModel ?? [])
                  .filter((m) => next.length === 0 || next.includes(m.provider))
                  .map((m) => m.model),
              );
              setModels((prev) => prev.filter((m) => allowedModels.has(m)));
            }}
          />
          <MultiSelectCombobox
            label="Модель"
            placeholder="Все модели"
            searchPlaceholder="Поиск модели…"
            className="w-48"
            options={modelOptions}
            selected={models}
            onChange={setModels}
          />
          <MultiSelectCombobox
            label="Модуль"
            placeholder="Все модули"
            searchPlaceholder="Поиск модуля…"
            className="w-56"
            options={taskTypeOptions}
            selected={taskTypes}
            onChange={setTaskTypes}
          />
          <MultiSelectCombobox
            label="Организация"
            placeholder="Все организации"
            searchPlaceholder="Поиск организации…"
            className="w-60"
            options={orgOptions}
            selected={orgIds}
            onChange={setOrgIds}
          />
          {hasFilters && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setProviders([]);
                setModels([]);
                setTaskTypes([]);
                setOrgIds([]);
              }}
            >
              Сбросить фильтры
            </Button>
          )}
        </div>

        {q.isLoading && <AdminLoading rows={6} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && isCustom && !hasCustomRange && (
          <AdminEmpty
            title="Укажите период"
            description="Заполните обе даты («Дата от» и «Дата до»), чтобы посмотреть свой период."
          />
        )}
        {!q.isLoading && !q.isForbidden && !q.error && q.data && (
          <DashboardContent data={q.data} />
        )}
      </div>
    </AdminSection>
  );
}

function DashboardContent({
  data,
}: {
  data: ReturnType<typeof adminDashboardFromApi>;
}) {
  const series = useMemo(() => buildTrendSeries(data.trend), [data.trend]);

  const providerChartData = useMemo(
    () =>
      data.byProvider
        .slice(0, 10)
        .map((p) => ({ name: p.provider, costUsd: Number(p.costUsd.toFixed(4)) })),
    [data.byProvider],
  );
  const modelChartData = useMemo(
    () =>
      data.byModel
        .slice(0, 10)
        .map((m) => ({
          name: `${m.provider}/${m.model}`,
          costUsd: Number(m.costUsd.toFixed(4)),
        })),
    [data.byModel],
  );
  const functionsChartData = useMemo(
    () =>
      data.byTaskType
        .slice(0, 10)
        .map((t) => ({
          name: taskTypeLabel(t.taskType),
          costUsd: Number(t.costUsd.toFixed(4)),
        })),
    [data.byTaskType],
  );
  const orgsChartData = useMemo(
    () =>
      data.topOrgs.map((o) => ({
        name: o.name,
        costUsd: Number(o.costUsd.toFixed(4)),
      })),
    [data.topOrgs],
  );

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
  const modelsCsvRows = useMemo(
    () =>
      data.byModel.map((m) => ({
        provider: m.provider,
        model: m.model,
        calls: m.calls,
        costUsd: m.costUsd,
      })),
    [data.byModel],
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
          title="Расход по дням"
          value={formatUsd(data.totals.totalCostUsd)}
          data={series.cost}
          color="var(--accent)"
          formatValue={(v) => formatUsd(v)}
        />
        <SparkCard
          title="Вызовы по дням"
          value={data.totals.totalCalls.toLocaleString("ru-RU")}
          data={series.calls}
          color="var(--success, #10b981)"
          formatValue={(v) => Math.round(v).toLocaleString("ru-RU")}
        />
        <SparkCard
          title="Доля ошибок по дням"
          value={`${(data.totals.failRate * 100).toFixed(1)}%`}
          data={series.failRate}
          color="var(--warning, #f59e0b)"
          formatValue={(v) => `${(v * 100).toFixed(1)}%`}
        />
      </div>

      {}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.byProvider.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Расход по провайдерам</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminEmpty
                title="Нет данных"
                description="За выбранный период (и с учётом фильтров) ни одного вызова не зафиксировано."
              />
            </CardContent>
          </Card>
        ) : (
          <BarTrend
            title="Расход по провайдерам"
            icon={<Activity size={16} />}
            grad={GRAD.blue}
            data={providerChartData}
            xKey="name"
            dataKey="costUsd"
          />
        )}

        {data.byModel.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Расход по моделям</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminEmpty
                title="Нет данных"
                description="За выбранный период (и с учётом фильтров) ни одного вызова не зафиксировано."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <BarTrend
              title="Расход по моделям"
              icon={<Activity size={16} />}
              grad={GRAD.teal}
              data={modelChartData}
              xKey="name"
              dataKey="costUsd"
            />
            <div className="flex justify-end">
              <AdminCsvDownloadButton
                rows={modelsCsvRows}
                columns={[
                  { key: "provider", label: "Провайдер" },
                  { key: "model", label: "Модель" },
                  { key: "calls", label: "Вызовы" },
                  {
                    key: "costUsd",
                    label: "Расход, USD",
                    format: (v) => Number(v).toFixed(4),
                  },
                ]}
                filename="admin-by-model"
              />
            </div>
          </div>
        )}
      </div>

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
              <Link href="/admin/analytics/functions">
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
            <BarTrend
              title="Расход, $"
              icon={<DollarSign size={16} />}
              grad={GRAD.violet}
              data={functionsChartData}
              xKey="name"
              dataKey="costUsd"
            />
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
            <BarTrend
              title="Расход, $"
              icon={<DollarSign size={16} />}
              grad={GRAD.amber}
              data={orgsChartData}
              xKey="name"
              dataKey="costUsd"
            />
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
          {data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-fg-tertiary">
              Нет данных за период
            </div>
          ) : (
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
                  labelFormatter={(label) => String(label)}
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
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function buildTrendSeries(
  trend: Array<{ date: string; costUsd: number; calls: number; failedCalls: number }>,
): { cost: SeriesPoint[]; calls: SeriesPoint[]; failRate: SeriesPoint[] } {
  return {
    cost: trend.map((t) => ({ day: t.date, value: t.costUsd })),
    calls: trend.map((t) => ({ day: t.date, value: t.calls })),
    failRate: trend.map((t) => ({
      day: t.date,
      value: t.calls > 0 ? t.failedCalls / t.calls : 0,
    })),
  };
}
