"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Search } from "lucide-react";

import { adminLlmCostApi } from "@/api/admin-llm-cost.api";
import {
  formatRub,
  formatSharePct,
  isLlmCostModule,
  isLlmCostPeriod,
  llmCostCompaniesFromApi,
  llmCostCompanyDetailFromApi,
  llmCostModelDetailFromApi,
  llmCostModuleDetailFromApi,
  llmCostOverviewFromApi,
  LLM_COST_PERIODS,
  LLM_COST_PERIOD_LABELS,
  type LlmCostCompanyRowDomain,
  type LlmCostModule,
  type LlmCostPeriod,
  type LlmCostTrendGranularity,
} from "@/domain/admin-llm-cost";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminCsvDownloadButton } from "@/ui/components/admin/AdminCsvDownloadButton";
import { AdminSparkline } from "@/ui/components/admin/AdminSparkline";
import { AreaTrend } from "@/ui/components/dashboard/modern/AreaTrend";
import { CHART } from "@/ui/components/dashboard/modern/tokens";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { cn } from "@/ui/shadcn/lib/utils";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

type LlmCostView = "overview" | "model" | "module" | "companies" | "company";

const BASE_PATH = "/admin/analytics/llm-cost";

function parseView(raw: string | null): LlmCostView {
  if (
    raw === "model" ||
    raw === "module" ||
    raw === "companies" ||
    raw === "company"
  ) {
    return raw;
  }
  return "overview";
}

function buildLlmCostHref(params: {
  view: LlmCostView;
  id?: string;
  period: LlmCostPeriod;
}): string {
  const usp = new URLSearchParams();
  usp.set("view", params.view);
  if (params.id) usp.set("id", params.id);
  usp.set("period", params.period);
  return `${BASE_PATH}?${usp.toString()}`;
}

export function LlmCostDashboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const view = parseView(searchParams.get("view"));
  const id = searchParams.get("id");
  const period: LlmCostPeriod = isLlmCostPeriod(searchParams.get("period"))
    ? (searchParams.get("period") as LlmCostPeriod)
    : "30d";

  useEffect(() => {
    if (searchParams.get("view") && searchParams.get("period")) return;
    router.replace(
      buildLlmCostHref({ view, ...(id ? { id } : {}), period }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPeriod = useCallback(
    (nextPeriod: LlmCostPeriod) => {
      router.push(
        buildLlmCostHref({ view, ...(id ? { id } : {}), period: nextPeriod }),
      );
    },
    [router, view, id],
  );

  if (view === "model" && id) {
    return (
      <ModelDetailView model={id} period={period} onPeriodChange={setPeriod} />
    );
  }
  if (view === "module" && id && isLlmCostModule(id)) {
    return (
      <ModuleDetailView
        module={id}
        period={period}
        onPeriodChange={setPeriod}
      />
    );
  }
  if (view === "companies") {
    return <CompaniesListView period={period} onPeriodChange={setPeriod} />;
  }
  if (view === "company" && id) {
    return (
      <CompanyDetailView
        tenantId={id}
        period={period}
        onPeriodChange={setPeriod}
      />
    );
  }
  return <OverviewView period={period} onPeriodChange={setPeriod} />;
}

function PeriodSwitcher({
  value,
  onChange,
}: {
  value: LlmCostPeriod;
  onChange: (p: LlmCostPeriod) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-bg-overlay p-1">
      {LLM_COST_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            value === p
              ? "bg-bg-card text-fg-primary shadow-sm"
              : "text-fg-tertiary hover:text-fg-primary",
          )}
        >
          {LLM_COST_PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function GranularitySwitcher({
  value,
  onChange,
}: {
  value: LlmCostTrendGranularity;
  onChange: (g: LlmCostTrendGranularity) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
      <button
        type="button"
        onClick={() => onChange("day")}
        className={cn(
          "rounded px-2 py-1",
          value === "day" && "bg-bg-overlay font-medium text-fg-primary",
        )}
      >
        По дням
      </button>
      <button
        type="button"
        onClick={() => onChange("week")}
        className={cn(
          "rounded px-2 py-1",
          value === "week" && "bg-bg-overlay font-medium text-fg-primary",
        )}
      >
        По неделям
      </button>
    </div>
  );
}

function BackLink({ href, label = "Назад" }: { href: string; label?: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>
        <ArrowLeft size={14} /> {label}
      </Link>
    </Button>
  );
}

function ChangeBadge({ changePct }: { changePct: number | null }) {
  if (changePct === null) return null;
  const up = changePct >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
      style={{
        color: up ? "var(--chip-warning-fg)" : "var(--chip-success-fg)",
        background: up ? "var(--chip-warning-bg)" : "var(--chip-success-bg)",
      }}
    >
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(changePct).toFixed(0)}% к пред. периоду
    </span>
  );
}

function DoorCard({
  label,
  costRub,
  sharePct,
  href,
}: {
  label: string;
  costRub: number;
  sharePct: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border-subtle bg-bg-overlay p-4 transition-colors hover:border-accent/50 hover:bg-accent-muted/10"
    >
      <div
        className="truncate text-sm font-medium text-fg-primary"
        title={label}
      >
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">
          {formatRub(costRub)}
        </span>
        <span className="text-xs text-fg-tertiary">
          {formatSharePct(sharePct)}
        </span>
      </div>
    </Link>
  );
}

type ExpandedRow = {
  key: string;
  label: string;
  costRub: number;
  sharePct: number;
  href: string;
};

function ExpandedList({ rows }: { rows: ExpandedRow[] }) {
  return (
    <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
      {rows.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-bg-overlay"
        >
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums text-fg-tertiary">
            <span>{formatRub(r.costRub)}</span>
            <span className="text-xs">{formatSharePct(r.sharePct)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function BreakdownBars({ rows }: { rows: ExpandedRow[] }) {
  const maxCost = Math.max(1, ...rows.map((r) => r.costRub));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          className="block rounded-lg px-2 py-1.5 hover:bg-bg-overlay"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 tabular-nums text-fg-secondary">
              {formatRub(r.costRub)}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-overlay">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(2, (r.costRub / maxCost) * 100)}%` }}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}

type PeriodViewProps = {
  period: LlmCostPeriod;
  onPeriodChange: (p: LlmCostPeriod) => void;
};

function OverviewView({ period, onPeriodChange }: PeriodViewProps) {
  const [granularity, setGranularity] = useState<LlmCostTrendGranularity>("day");
  const [showAllModels, setShowAllModels] = useState(false);
  const [showAllModules, setShowAllModules] = useState(false);
  const [showAllCompanies, setShowAllCompanies] = useState(false);

  const q = useAdminQuery(
    `llm-cost-overview:${period}:${granularity}`,
    async () =>
      llmCostOverviewFromApi(
        await adminLlmCostApi.overview({ period, trend: granularity }),
      ),
    [period, granularity],
  );

  const companiesHref = buildLlmCostHref({ view: "companies", period });

  const trendData: Array<Record<string, unknown>> = (q.data?.trend ?? []).map(
    (t) => ({ date: t.date, costRub: t.costRub }),
  );
  const csvByModelRows: Array<Record<string, unknown>> = (
    q.data?.byModel ?? []
  ).map((m) => ({
    model: m.model,
    costRub: Math.round(m.costRub),
    sharePct: Number(m.sharePct.toFixed(1)),
  }));

  return (
    <AdminSection
      title="Расход на LLM"
      description="Единый источник расхода на AI — по моделям, разделам и компаниям, в рублях."
      actions={
        <>
          <PeriodSwitcher value={period} onChange={onPeriodChange} />
          <AdminCsvDownloadButton
            rows={csvByModelRows}
            columns={[
              { key: "model", label: "Модель" },
              { key: "costRub", label: "Расход, ₽" },
              { key: "sharePct", label: "Доля, %" },
            ]}
            filename={`llm-cost-overview-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-6">
        {q.isLoading && <AdminLoading rows={6} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && q.data && q.data.totals.callsCount === 0 && (
          <AdminEmpty
            title="Нет расхода за период"
            description="За выбранный период не нашлось ни одного оплаченного LLM-вызова. Попробуйте более широкий период."
          />
        )}
        {!q.isLoading && q.data && q.data.totals.callsCount > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-[32px] font-semibold leading-none tracking-tight">
                {formatRub(q.data.totals.costRub)}
              </span>
              <ChangeBadge changePct={q.data.totals.changePct} />
              <span className="text-sm text-fg-tertiary">
                {q.data.totals.callsCount.toLocaleString("ru-RU")} вызовов
              </span>
            </div>

            <div>
              <div className="mb-2 flex justify-end">
                <GranularitySwitcher
                  value={granularity}
                  onChange={setGranularity}
                />
              </div>
              <AreaTrend
                data={trendData}
                xKey="date"
                series={[
                  { key: "costRub", color: CHART.mint, label: "Расход, ₽" },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                  По моделям
                </div>
                {q.data.byModel[0] && (
                  <DoorCard
                    label={q.data.byModel[0].model}
                    costRub={q.data.byModel[0].costRub}
                    sharePct={q.data.byModel[0].sharePct}
                    href={buildLlmCostHref({
                      view: "model",
                      id: q.data.byModel[0].model,
                      period,
                    })}
                  />
                )}
                {q.data.byModel.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllModels((v) => !v)}
                  >
                    {showAllModels ? "Свернуть" : "Показать все модели"}
                  </Button>
                )}
                {showAllModels && (
                  <ExpandedList
                    rows={q.data.byModel.map((m) => ({
                      key: m.model,
                      label: m.model,
                      costRub: m.costRub,
                      sharePct: m.sharePct,
                      href: buildLlmCostHref({
                        view: "model",
                        id: m.model,
                        period,
                      }),
                    }))}
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                  По разделам
                </div>
                {q.data.byModule[0] && (
                  <DoorCard
                    label={q.data.byModule[0].label}
                    costRub={q.data.byModule[0].costRub}
                    sharePct={q.data.byModule[0].sharePct}
                    href={buildLlmCostHref({
                      view: "module",
                      id: q.data.byModule[0].module,
                      period,
                    })}
                  />
                )}
                {q.data.byModule.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllModules((v) => !v)}
                  >
                    {showAllModules ? "Свернуть" : "Все разделы"}
                  </Button>
                )}
                {showAllModules && (
                  <ExpandedList
                    rows={q.data.byModule.map((m) => ({
                      key: m.module,
                      label: m.label,
                      costRub: m.costRub,
                      sharePct: m.sharePct,
                      href: buildLlmCostHref({
                        view: "module",
                        id: m.module,
                        period,
                      }),
                    }))}
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                  <Link
                    href={companiesHref}
                    className="hover:text-fg-primary hover:underline"
                  >
                    По компаниям →
                  </Link>
                </div>
                {q.data.topCompanies[0] && (
                  <DoorCard
                    label={q.data.topCompanies[0].name}
                    costRub={q.data.topCompanies[0].costRub}
                    sharePct={q.data.topCompanies[0].sharePct}
                    href={buildLlmCostHref({
                      view: "company",
                      id: q.data.topCompanies[0].tenantId,
                      period,
                    })}
                  />
                )}
                {q.data.topCompanies.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllCompanies((v) => !v)}
                  >
                    {showAllCompanies ? "Свернуть" : "Все компании"}
                  </Button>
                )}
                {showAllCompanies && (
                  <ExpandedList
                    rows={q.data.topCompanies.map((c) => ({
                      key: c.tenantId,
                      label: c.name,
                      costRub: c.costRub,
                      sharePct: c.sharePct,
                      href: buildLlmCostHref({
                        view: "company",
                        id: c.tenantId,
                        period,
                      }),
                    }))}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminSection>
  );
}

function ModelDetailView({
  model,
  period,
  onPeriodChange,
}: PeriodViewProps & { model: string }) {
  const [granularity, setGranularity] = useState<LlmCostTrendGranularity>("day");

  const q = useAdminQuery(
    `llm-cost-model:${model}:${period}:${granularity}`,
    async () =>
      llmCostModelDetailFromApi(
        await adminLlmCostApi.modelDetail(model, { period, trend: granularity }),
      ),
    [model, period, granularity],
  );

  const overviewHref = buildLlmCostHref({ view: "overview", period });
  const trendData: Array<Record<string, unknown>> = (q.data?.trend ?? []).map(
    (t) => ({ date: t.date, costRub: t.costRub }),
  );
  const csvRows: Array<Record<string, unknown>> = (q.data?.byModule ?? []).map(
    (m) => ({
      label: m.label,
      costRub: Math.round(m.costRub),
      sharePct: Number(m.sharePct.toFixed(1)),
    }),
  );

  return (
    <AdminSection
      breadcrumbs={[
        { label: "Расход на LLM", href: overviewHref },
        { label: `Модель: ${model}` },
      ]}
      title={`Модель: ${model}`}
      actions={
        <>
          <BackLink href={overviewHref} />
          <PeriodSwitcher value={period} onChange={onPeriodChange} />
          <AdminCsvDownloadButton
            rows={csvRows}
            columns={[
              { key: "label", label: "Раздел" },
              { key: "costRub", label: "Расход, ₽" },
              { key: "sharePct", label: "Доля, %" },
            ]}
            filename={`llm-cost-model-${model}-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-6">
        {q.isLoading && <AdminLoading rows={5} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && q.data && q.data.totals.costRub === 0 && (
          <AdminEmpty
            title="Нет расхода по этой модели"
            description="За выбранный период эта модель не использовалась ни в одном разделе."
          />
        )}
        {!q.isLoading && q.data && q.data.totals.costRub > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-[32px] font-semibold leading-none tracking-tight">
                {formatRub(q.data.totals.costRub)}
              </span>
              <span className="text-sm text-fg-tertiary">
                {formatSharePct(q.data.totals.sharePct)} всего расхода
              </span>
            </div>
            <div>
              <div className="mb-2 flex justify-end">
                <GranularitySwitcher
                  value={granularity}
                  onChange={setGranularity}
                />
              </div>
              <AreaTrend
                data={trendData}
                xKey="date"
                series={[
                  { key: "costRub", color: CHART.blue, label: "Расход, ₽" },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-fg-secondary">
                Кто её вызывает, по разделам
              </div>
              <BreakdownBars
                rows={q.data.byModule.map((m) => ({
                  key: m.module,
                  label: m.label,
                  costRub: m.costRub,
                  sharePct: m.sharePct,
                  href: buildLlmCostHref({
                    view: "module",
                    id: m.module,
                    period,
                  }),
                }))}
              />
            </div>
          </>
        )}
      </div>
    </AdminSection>
  );
}

const TASK_TYPE_COLLAPSE_LIMIT = 5;

function ModuleDetailView({
  module,
  period,
  onPeriodChange,
}: PeriodViewProps & { module: LlmCostModule }) {
  const [granularity, setGranularity] = useState<LlmCostTrendGranularity>("day");
  const [showAll, setShowAll] = useState(false);

  const q = useAdminQuery(
    `llm-cost-module:${module}:${period}:${granularity}`,
    async () =>
      llmCostModuleDetailFromApi(
        await adminLlmCostApi.moduleDetail(module, {
          period,
          trend: granularity,
        }),
      ),
    [module, period, granularity],
  );

  const overviewHref = buildLlmCostHref({ view: "overview", period });
  const title = q.data?.label ?? module;
  const trendData: Array<Record<string, unknown>> = (q.data?.trend ?? []).map(
    (t) => ({ date: t.date, costRub: t.costRub }),
  );
  const csvRows: Array<Record<string, unknown>> = (
    q.data?.byTaskType ?? []
  ).map((r) => ({
    taskType: r.taskType,
    costRub: Math.round(r.costRub),
    callsCount: r.callsCount,
  }));

  const byTaskType = q.data?.byTaskType ?? [];
  const visibleRows = showAll
    ? byTaskType
    : byTaskType.slice(0, TASK_TYPE_COLLAPSE_LIMIT);
  const restRows = showAll ? [] : byTaskType.slice(TASK_TYPE_COLLAPSE_LIMIT);
  const restCostRub = restRows.reduce((sum, r) => sum + r.costRub, 0);

  return (
    <AdminSection
      breadcrumbs={[
        { label: "Расход на LLM", href: overviewHref },
        { label: `Раздел: ${title}` },
      ]}
      title={`Раздел: ${title}`}
      actions={
        <>
          <BackLink href={overviewHref} />
          <PeriodSwitcher value={period} onChange={onPeriodChange} />
          <AdminCsvDownloadButton
            rows={csvRows}
            columns={[
              { key: "taskType", label: "Вид операции" },
              { key: "costRub", label: "Расход, ₽" },
              { key: "callsCount", label: "Вызовов" },
            ]}
            filename={`llm-cost-module-${module}-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-6">
        {q.isLoading && <AdminLoading rows={5} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && q.data && q.data.totals.costRub === 0 && (
          <AdminEmpty
            title="Нет расхода по этому разделу"
            description="За выбранный период в этом разделе не было платных LLM-вызовов."
          />
        )}
        {!q.isLoading && q.data && q.data.totals.costRub > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-[32px] font-semibold leading-none tracking-tight">
                {formatRub(q.data.totals.costRub)}
              </span>
              <span className="text-sm text-fg-tertiary">
                {formatSharePct(q.data.totals.sharePct)} всего расхода
              </span>
            </div>
            <div>
              <div className="mb-2 flex justify-end">
                <GranularitySwitcher
                  value={granularity}
                  onChange={setGranularity}
                />
              </div>
              <AreaTrend
                data={trendData}
                xKey="date"
                series={[
                  { key: "costRub", color: CHART.violet, label: "Расход, ₽" },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-fg-secondary">
                Из чего состоит ({byTaskType.length} видов вызова)
              </div>
              <div className="overflow-hidden rounded-lg border border-border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                    <tr>
                      <th className="px-3 py-2 text-left">Вид операции</th>
                      <th className="px-3 py-2 text-right">Расход, ₽</th>
                      <th className="px-3 py-2 text-right">Вызовов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr
                        key={r.taskType}
                        className="border-t border-border-subtle hover:bg-bg-overlay"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/analytics/functions/${encodeURIComponent(r.taskType)}`}
                            className="font-mono text-xs text-accent hover:underline"
                          >
                            {r.taskType}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatRub(r.costRub)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.callsCount.toLocaleString("ru-RU")}
                        </td>
                      </tr>
                    ))}
                    {!showAll && restRows.length > 0 && (
                      <tr className="border-t border-border-subtle text-fg-tertiary">
                        <td className="px-3 py-2">
                          Прочие {restRows.length} видов
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatRub(restCostRub)}
                        </td>
                        <td className="px-3 py-2 text-right">—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!showAll && restRows.length > 0 && (
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAll(true)}
                  >
                    Показать полный список из {byTaskType.length} видов
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminSection>
  );
}

function CompaniesListView({ period, onPeriodChange }: PeriodViewProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulator, setAccumulator] = useState<LlmCostCompanyRowDomain[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    setCursor(undefined);
  }, [period, search]);

  const q = useAdminQuery(
    `llm-cost-companies:${period}:${search}:${cursor ?? ""}`,
    async () => {
      const res = llmCostCompaniesFromApi(
        await adminLlmCostApi.companies({
          period,
          limit: 50,
          ...(cursor ? { cursor } : {}),
          ...(search ? { search } : {}),
        }),
      );
      setAccumulator((prev) => (cursor ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
      return res;
    },
    [period, search, cursor],
  );

  const overviewHref = buildLlmCostHref({ view: "overview", period });
  const csvRows: Array<Record<string, unknown>> = accumulator.map((c) => ({
    name: c.name,
    tenantId: c.tenantId,
    costRub: Math.round(c.costRub),
    sharePct: Number(c.sharePct.toFixed(1)),
  }));

  return (
    <AdminSection
      breadcrumbs={[
        { label: "Расход на LLM", href: overviewHref },
        { label: "По компаниям" },
      ]}
      title="Расход на LLM · По компаниям"
      actions={
        <>
          <BackLink href={overviewHref} />
          <PeriodSwitcher value={period} onChange={onPeriodChange} />
          <AdminCsvDownloadButton
            rows={csvRows}
            columns={[
              { key: "name", label: "Компания" },
              { key: "tenantId", label: "tenantId" },
              { key: "costRub", label: "Расход, ₽" },
              { key: "sharePct", label: "Доля, %" },
            ]}
            filename={`llm-cost-companies-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-4">
        <form
          className="flex max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Input
            placeholder="имя или slug компании"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary">
            <Search size={14} /> Найти
          </Button>
        </form>

        {q.isLoading && accumulator.length === 0 && <AdminLoading rows={6} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && !q.error && accumulator.length === 0 && (
          <AdminEmpty
            title={search ? "Ничего не найдено" : "Нет расхода за период"}
            description={
              search
                ? "Попробуйте изменить условия поиска."
                : "За выбранный период ни одна компания не потратила на LLM."
            }
          />
        )}
        {accumulator.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-lg border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-left">Компания</th>
                    <th className="px-3 py-2 text-right">₽/период</th>
                    <th className="px-3 py-2 text-right">Доля</th>
                    <th className="px-3 py-2 text-right">График</th>
                  </tr>
                </thead>
                <tbody>
                  {accumulator.map((c) => (
                    <tr
                      key={c.tenantId}
                      className="border-t border-border-subtle hover:bg-bg-overlay"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={buildLlmCostHref({
                            view: "company",
                            id: c.tenantId,
                            period,
                          })}
                          className="text-accent hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatRub(c.costRub)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-tertiary">
                        {formatSharePct(c.sharePct)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="ml-auto w-fit">
                          <AdminSparkline
                            data={c.trend.map((t) => ({
                              x: t.date,
                              y: t.costRub,
                            }))}
                            width={100}
                            height={28}
                            ariaLabel={`Динамика расхода ${c.name}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={q.isLoading}
                  onClick={() => setCursor(nextCursor)}
                >
                  {q.isLoading ? "Загружаем…" : "Показать ещё"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminSection>
  );
}

function CompanyDetailView({
  tenantId,
  period,
  onPeriodChange,
}: PeriodViewProps & { tenantId: string }) {
  const [granularity, setGranularity] = useState<LlmCostTrendGranularity>("day");

  const q = useAdminQuery(
    `llm-cost-company:${tenantId}:${period}:${granularity}`,
    async () =>
      llmCostCompanyDetailFromApi(
        await adminLlmCostApi.companyDetail(tenantId, {
          period,
          trend: granularity,
        }),
      ),
    [tenantId, period, granularity],
  );

  const overviewHref = buildLlmCostHref({ view: "overview", period });
  const companiesHref = buildLlmCostHref({ view: "companies", period });
  const title = q.data?.name ?? tenantId;
  const trendData: Array<Record<string, unknown>> = (q.data?.trend ?? []).map(
    (t) => ({ date: t.date, costRub: t.costRub }),
  );
  const csvRows: Array<Record<string, unknown>> = (q.data?.byModel ?? []).map(
    (m) => ({
      model: m.model,
      costRub: Math.round(m.costRub),
      sharePct: Number(m.sharePct.toFixed(1)),
    }),
  );

  return (
    <AdminSection
      breadcrumbs={[
        { label: "Расход на LLM", href: overviewHref },
        { label: "По компаниям", href: companiesHref },
        { label: title },
      ]}
      title={title}
      actions={
        <>
          <BackLink href={companiesHref} label="К списку компаний" />
          <PeriodSwitcher value={period} onChange={onPeriodChange} />
          <AdminCsvDownloadButton
            rows={csvRows}
            columns={[
              { key: "model", label: "Модель" },
              { key: "costRub", label: "Расход, ₽" },
              { key: "sharePct", label: "Доля, %" },
            ]}
            filename={`llm-cost-company-${tenantId}-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-6">
        {q.isLoading && <AdminLoading rows={5} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && q.data && q.data.totals.costRub === 0 && (
          <AdminEmpty
            title="Нет расхода у этой компании"
            description="За выбранный период у этой компании не было платных LLM-вызовов."
          />
        )}
        {!q.isLoading && q.data && q.data.totals.costRub > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-[32px] font-semibold leading-none tracking-tight">
                {formatRub(q.data.totals.costRub)}
              </span>
            </div>
            <div>
              <div className="mb-2 flex justify-end">
                <GranularitySwitcher
                  value={granularity}
                  onChange={setGranularity}
                />
              </div>
              <AreaTrend
                data={trendData}
                xKey="date"
                series={[
                  { key: "costRub", color: CHART.amber, label: "Расход, ₽" },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-fg-secondary">
                По моделям
              </div>
              <div className="overflow-hidden rounded-lg border border-border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                    <tr>
                      <th className="px-3 py-2 text-left">Модель</th>
                      <th className="px-3 py-2 text-right">₽/период</th>
                      <th className="px-3 py-2 text-right">% от компании</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.byModel.map((m) => (
                      <tr
                        key={m.model}
                        className="border-t border-border-subtle hover:bg-bg-overlay"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={buildLlmCostHref({
                              view: "model",
                              id: m.model,
                              period,
                            })}
                            className="text-accent hover:underline"
                          >
                            {m.model}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatRub(m.costRub)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-tertiary">
                          {formatSharePct(m.sharePct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminSection>
  );
}
