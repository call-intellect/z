"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical,
  History,
  LineChart,
  ListTree,
  Loader2,
  Play,
} from "lucide-react";
import Link from "next/link";

import { ApiError } from "@/api/api-error";
import {
  adminAiModelsApi,
  type ModelExperimentApi,
  type RouteChangeApi,
  type TaskTypeMetricsApi,
} from "@/api/admin-ai-models.api";
import {
  changeTypeLabel,
  formatCostRub,
  formatLatency,
  formatPercent,
  tierLabel,
} from "@/domain/admin-ai-model";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminTabs, type AdminTabDef } from "@/ui/components/admin/AdminTabs";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";

import { AdminEmpty } from "../../../AdminStateViews";
import { TaskTypeDetailsClient } from "../../../ai-models/[taskType]/TaskTypeDetailsClient";
import { adminRootCrumb } from "@/ui/components/admin/brand";

interface Props {
  taskType: string;
}

const TABS: AdminTabDef[] = [
  { value: "chain", label: "Цепочка", icon: ListTree },
  { value: "metrics", label: "Метрики", icon: LineChart },
  { value: "history", label: "История переключений", icon: History },
  { value: "ab", label: "A/B", icon: FlaskConical },
];

export function RoutingDetailClient({ taskType }: Props) {
  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "AI и модели" },
        { label: "Роутинг моделей", href: "/admin/ai/routing" },
        { label: taskType },
      ]}
      title={taskType}
      description="Цепочка моделей агентa, метрики, история переключений и A/B-эксперимент."
    >
      <AdminTabs tabs={TABS}>
        {(active) => (
          <>
            {active === "chain" && (
              <TaskTypeDetailsClient taskType={taskType} />
            )}
            {active === "metrics" && <MetricsTabSection taskType={taskType} />}
            {active === "history" && <HistoryTabSection taskType={taskType} />}
            {active === "ab" && <AbTabSection taskType={taskType} />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

type UnifiedPeriod = "day" | "week" | "month";
const PERIOD_OPTIONS: ReadonlyArray<{ value: UnifiedPeriod; label: string }> = [
  { value: "day", label: "Сутки" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
];
function periodToApi(p: UnifiedPeriod): "24h" | "7d" | "30d" {
  return p === "day" ? "24h" : p === "week" ? "7d" : "30d";
}

function MetricsTabSection({ taskType }: { taskType: string }) {
  const [metrics, setMetrics] = useState<TaskTypeMetricsApi | null>(null);
  const [period, setPeriod] = useState<UnifiedPeriod>("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await adminAiModelsApi.metrics(taskType, periodToApi(period));
      setMetrics(m);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось загрузить метрики",
      );
    } finally {
      setLoading(false);
    }
  }, [taskType, period]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg-primary">
          Метрики за период
        </h2>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`rounded px-2 py-1 text-xs ${
                period === p.value
                  ? "bg-fg-primary text-bg-card"
                  : "bg-bg-subtle text-fg-secondary hover:bg-bg-overlay"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-fg-secondary">
          <Loader2 size={14} className="animate-spin" /> Загружаем…
        </div>
      )}
      {error && !loading && (
        <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          {error}
        </p>
      )}
      {!loading && metrics && (
        <div className="overflow-hidden rounded border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Уровень</th>
                <th className="px-3 py-2 text-right font-medium">Вызовов</th>
                <th className="px-3 py-2 text-right font-medium">Успех</th>
                <th className="px-3 py-2 text-right font-medium">
                  Латентность p95
                </th>
                <th className="px-3 py-2 text-right font-medium">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {(["primary", "secondary", "tertiary"] as const).map((t) => {
                const row = metrics.perTier[t];
                return (
                  <tr key={t} className="border-t border-border-subtle">
                    <td className="px-3 py-2">{tierLabel(t)}</td>
                    <td className="px-3 py-2 text-right">{row.calls}</td>
                    <td className="px-3 py-2 text-right">
                      {formatPercent(row.successRate)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatLatency(row.p95LatencyMs)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCostRub(row.costUsd)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border-subtle bg-bg-subtle font-medium">
                <td className="px-3 py-2">Итого</td>
                <td className="px-3 py-2 text-right">{metrics.totals.calls}</td>
                <td className="px-3 py-2 text-right">
                  {metrics.totals.calls > 0
                    ? formatPercent(
                        metrics.totals.successCalls / metrics.totals.calls,
                      )
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs text-fg-secondary">
                  fallback: {formatPercent(metrics.totals.fallbackRate)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCostRub(metrics.totals.totalCostUsd)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistoryTabSection({ taskType }: { taskType: string }) {
  const [items, setItems] = useState<RouteChangeApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await adminAiModelsApi.history(taskType);
      setItems(h.items);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось загрузить историю",
      );
    } finally {
      setLoading(false);
    }
  }, [taskType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <h2 className="mb-3 text-base font-semibold text-fg-primary">
        История переключений
      </h2>
      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-fg-secondary">
          <Loader2 size={14} className="animate-spin" /> Загружаем…
        </div>
      )}
      {error && !loading && (
        <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <AdminEmpty
          title="История пуста"
          description="По этому taskType ещё не было ни одной правки модели."
        />
      )}
      {!loading && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((h) => (
            <li
              key={h.id}
              className="rounded-md border border-border-subtle bg-bg-subtle p-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-fg-secondary">
                  {new Date(h.createdAt).toLocaleString("ru-RU")}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {changeTypeLabel(h.changeType)}
                </Badge>
                {h.tier ? (
                  <span className="text-[10px] text-fg-secondary">
                    {tierLabel(h.tier)}
                  </span>
                ) : null}
              </div>
              {h.reason ? (
                <div className="mt-1 text-fg-secondary">{h.reason}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AbTabSection({ taskType }: { taskType: string }) {
  const [items, setItems] = useState<ModelExperimentApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminAiModelsApi.experimentsList({ taskType });
      setItems(res.items);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Не удалось загрузить эксперименты",
      );
    } finally {
      setLoading(false);
    }
  }, [taskType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = items.find((it) => it.status === "running");

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg-primary">
          A/B-эксперимент
        </h2>
        <Link href="/admin/ai-models/experiments">
          <Button size="sm" variant="outline">
            <Play size={12} className="mr-1" /> Все эксперименты
          </Button>
        </Link>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm text-fg-secondary">
          <Loader2 size={14} className="animate-spin" /> Загружаем…
        </div>
      )}
      {error && !loading && (
        <p className="rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
          {error}
        </p>
      )}
      {!loading && !error && !running && items.length === 0 && (
        <AdminEmpty
          title="Активного эксперимента нет"
          description="Чтобы запустить A/B — откройте вкладку «Цепочка», нажмите «Переключить основную» и укажите долю трафика меньше 100%."
        />
      )}
      {!loading && running && (
        <div className="rounded-md border border-border-subtle bg-bg-subtle p-3 text-xs">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
            >
              Активный эксперимент
            </Badge>
            <span className="text-fg-secondary">
              {running.splitPercent}% трафика → вариант
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-fg-tertiary">
                Контроль
              </p>
              <p className="font-mono text-xs text-fg-primary">
                {running.controlProvider} / {running.controlModel}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-fg-tertiary">
                Вариант
              </p>
              <p className="font-mono text-xs text-fg-primary">
                {running.variantProvider} / {running.variantModel}
              </p>
            </div>
          </div>
          {running.notes ? (
            <p className="mt-2 text-fg-secondary">{running.notes}</p>
          ) : null}
        </div>
      )}
      {!loading && !running && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-md border border-border-subtle bg-bg-subtle p-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {it.status}
                </Badge>
                <span className="font-mono text-[10px] text-fg-secondary">
                  {new Date(it.createdAt).toLocaleString("ru-RU")}
                </span>
                <span className="text-fg-secondary">
                  {it.splitPercent}% · {it.variantProvider}/{it.variantModel}
                </span>
              </div>
              {it.notes ? (
                <p className="mt-1 text-fg-secondary">{it.notes}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
