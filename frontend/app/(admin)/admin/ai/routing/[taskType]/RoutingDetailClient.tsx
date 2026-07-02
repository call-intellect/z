"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  ArrowLeft,
  History,
  LineChart,
  ListTree,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import {
  AI_MODELS_TIERS,
  adminAiModelsApi,
  type AiModelTier,
  type PutChainEntryRequest,
  type RouteChangeApi,
  type TaskTypeMetricsApi,
} from "@/api/admin-ai-models.api";
import { adminLlmModelsApi } from "@/api/admin-llm-models.api";
import { adminLlmProvidersApi } from "@/api/admin-llm-providers.api";
import {
  adminLlmModelFromApi,
  type AdminLlmModelDomain,
} from "@/domain/admin-llm-model";
import { adminLlmProviderFromApi } from "@/domain/admin-llm-provider";
import {
  changeTypeLabel,
  formatCostRub,
  formatLatency,
  formatPercent,
  mapTaskTypeRoute,
  tierLabel,
} from "@/domain/admin-ai-model";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { AdminTabs, type AdminTabDef } from "@/ui/components/admin/AdminTabs";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";
import { Textarea } from "@/ui/shadcn/textarea";

import { AdminEmpty, AdminError, AdminLoading } from "../../../AdminStateViews";
import { useAdminQuery } from "../../../useAdminQuery";
import { adminRootCrumb } from "@/ui/components/admin/brand";

interface Props {
  taskType: string;
}

const TABS: AdminTabDef[] = [
  { value: "chain", label: "Цепочка", icon: ListTree },
  { value: "metrics", label: "Метрики", icon: LineChart },
  { value: "history", label: "История переключений", icon: History },
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
      description="Цепочка моделей агента, метрики и история переключений."
    >
      <AdminTabs tabs={TABS}>
        {(active) => (
          <>
            {active === "chain" && <ChainTabSection taskType={taskType} />}
            {active === "metrics" && <MetricsTabSection taskType={taskType} />}
            {active === "history" && <HistoryTabSection taskType={taskType} />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

type ChainRowState = {
  key: string;
  tier: AiModelTier;
  providerName: string;
  model: string;
  manualModel: boolean;
};

const TIER_TITLES: Record<AiModelTier, string> = {
  primary: "Основная",
  secondary: "Запасная",
  tertiary: "Локальная",
};

function ChainTabSection({ taskType }: { taskType: string }) {
  const providersQ = useAdminQuery(
    "admin-llm-providers-for-routing",
    async () => {
      const res = await adminLlmProvidersApi.list({ includeInactive: false });
      return res.items.map(adminLlmProviderFromApi);
    },
    [],
  );
  const modelsQ = useAdminQuery(
    "admin-llm-models-for-routing",
    async () => {
      const res = await adminLlmModelsApi.list({ includeInactive: false });
      return res.items.map(adminLlmModelFromApi);
    },
    [],
  );
  const detailQ = useAdminQuery(
    `ai-models-detail:${taskType}`,
    async () => mapTaskTypeRoute(await adminAiModelsApi.detail(taskType)),
    [taskType],
  );

  const providers = useMemo(
    () => providersQ.data ?? [],
    [providersQ.data],
  );
  const models = useMemo(() => modelsQ.data ?? [], [modelsQ.data]);

  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ name: string; label: string }> = [];
    for (const p of providers) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      opts.push({ name: p.name, label: p.displayName });
    }
    return opts;
  }, [providers]);

  const [rows, setRows] = useState<ChainRowState[] | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [pinnedVersionNote, setPinnedVersionNote] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    seededRef.current = false;
    setRows(null);
  }, [taskType]);

  useEffect(() => {
    if (seededRef.current) return;
    if (!detailQ.data || providersQ.isLoading || modelsQ.isLoading) return;
    seededRef.current = true;
    setRows(
      detailQ.data.chain.map((entry) => {
        const dbProvider = providers.find((p) => p.name === entry.providerName);
        const modelsForProvider = dbProvider
          ? models.filter((m) => m.providerId === dbProvider.id)
          : [];
        return {
          key: entry.id,
          tier: entry.tier,
          providerName: entry.providerName,
          model: entry.model ?? "",
          manualModel:
            !dbProvider ||
            modelsForProvider.length === 0 ||
            (entry.model !== null &&
              !modelsForProvider.some((m) => m.modelKey === entry.model)),
        };
      }),
    );
    setIsActive(true);
    setPinnedVersionNote("");
  }, [detailQ.data, providersQ.isLoading, modelsQ.isLoading, providers, models]);

  const modelsForProviderName = useCallback(
    (providerName: string): AdminLlmModelDomain[] => {
      const dbProvider = providers.find((p) => p.name === providerName);
      if (!dbProvider) return [];
      return models.filter((m) => m.providerId === dbProvider.id);
    },
    [providers, models],
  );

  const effectiveLabel = useCallback(
    (row: ChainRowState): string => {
      const dbProvider = providers.find((p) => p.name === row.providerName);
      const label = dbProvider?.displayName ?? row.providerName;
      const model = row.model.trim();
      if (model) return `${label} / ${model}`;
      if (dbProvider?.defaultModelKey) {
        return `${label} / ${dbProvider.defaultModelKey} (по умолчанию провайдера)`;
      }
      return `${label} / — модель не задана —`;
    },
    [providers],
  );

  const updateRow = useCallback(
    (key: string, patch: Partial<ChainRowState>) => {
      setRows((prev) =>
        prev ? prev.map((r) => (r.key === key ? { ...r, ...patch } : r)) : prev,
      );
    },
    [],
  );

  const handleProviderChange = useCallback(
    (key: string, providerName: string) => {
      const opts = modelsForProviderName(providerName);
      updateRow(key, {
        providerName,
        model: "",
        manualModel: opts.length === 0,
      });
    },
    [modelsForProviderName, updateRow],
  );

  const removeRow = useCallback((key: string) => {
    setRows((prev) => (prev ? prev.filter((r) => r.key !== key) : prev));
  }, []);

  const addRow = useCallback(
    (tier: AiModelTier) => {
      const defaultProviderName = providerOptions[0]?.name ?? "";
      const opts = modelsForProviderName(defaultProviderName);
      setRows((prev) => [
        ...(prev ?? []),
        {
          key: nanoid(),
          tier,
          providerName: defaultProviderName,
          model: "",
          manualModel: opts.length === 0,
        },
      ]);
    },
    [providerOptions, modelsForProviderName],
  );

  const handleSave = useCallback(async () => {
    if (!rows || rows.length === 0) {
      toast.error("Нужна хотя бы одна запись в цепочке");
      return;
    }
    if (rows.some((r) => !r.providerName)) {
      toast.error("Выберите провайдера в каждой строке");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Опишите причину изменения (минимум 3 символа)");
      return;
    }
    const entries: PutChainEntryRequest[] = [];
    for (const tier of AI_MODELS_TIERS) {
      rows
        .filter((r) => r.tier === tier)
        .forEach((r, idx) => {
          entries.push({
            tier,
            providerName: r.providerName,
            model: r.model.trim().length > 0 ? r.model.trim() : null,
            priority: idx,
          });
        });
    }
    setSaving(true);
    try {
      const res = await adminAiModelsApi.putChain(taskType, {
        entries,
        isActive,
        pinnedVersionNote:
          pinnedVersionNote.trim().length > 0 ? pinnedVersionNote.trim() : null,
        reason: reason.trim(),
      });
      if (res.warnings.length > 0) {
        toast.warning(`Сохранено с предупреждениями: ${res.warnings.join("; ")}`);
      } else {
        toast.success("Маршрут сохранён");
      }
      setReason("");
      void detailQ.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось сохранить маршрут",
      );
    } finally {
      setSaving(false);
    }
  }, [rows, reason, isActive, pinnedVersionNote, taskType, detailQ]);

  const anyLoading = providersQ.isLoading || modelsQ.isLoading || detailQ.isLoading;
  const anyError = providersQ.error || modelsQ.error || detailQ.error;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/ai/routing"
        className="inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft size={12} /> Назад к списку
      </Link>

      {anyLoading && !rows && <AdminLoading rows={3} />}
      {!anyLoading && anyError && (
        <AdminError message={anyError} onRetry={() => detailQ.refetch()} />
      )}

      {rows && (
        <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg-primary">
              Цепочка моделей
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-secondary">Активна</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <div className="space-y-5">
            {AI_MODELS_TIERS.map((tier) => (
              <div key={tier}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-fg-primary">
                    {TIER_TITLES[tier]}
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={providerOptions.length === 0}
                    onClick={() => addRow(tier)}
                  >
                    <Plus size={12} /> Добавить провайдера в {TIER_TITLES[tier].toLowerCase()}
                  </Button>
                </div>
                <div className="space-y-2">
                  {rows.filter((r) => r.tier === tier).length === 0 && (
                    <div className="rounded-md border border-dashed border-border-subtle p-2 text-xs text-fg-tertiary">
                      Пусто.
                    </div>
                  )}
                  {rows
                    .filter((r) => r.tier === tier)
                    .map((row) => {
                      const modelOptions = modelsForProviderName(row.providerName);
                      const canSelectModel = modelOptions.length > 0;
                      return (
                        <div
                          key={row.key}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-bg-subtle p-2"
                        >
                          <div className="w-56">
                            <Select
                              value={row.providerName}
                              onValueChange={(v) => handleProviderChange(row.key, v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Провайдер" />
                              </SelectTrigger>
                              <SelectContent>
                                {providerOptions.map((p) => (
                                  <SelectItem key={p.name} value={p.name}>
                                    {p.label}
                                  </SelectItem>
                                ))}
                                {!providerOptions.some(
                                  (p) => p.name === row.providerName,
                                ) && row.providerName ? (
                                  <SelectItem value={row.providerName}>
                                    {row.providerName}
                                  </SelectItem>
                                ) : null}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="w-56">
                            {canSelectModel && !row.manualModel ? (
                              <Select
                                value={row.model || "__default__"}
                                onValueChange={(v) =>
                                  updateRow(row.key, {
                                    model: v === "__default__" ? "" : v,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Модель" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__default__">
                                    По умолчанию провайдера
                                  </SelectItem>
                                  {modelOptions.map((m) => (
                                    <SelectItem key={m.id} value={m.modelKey}>
                                      {m.displayName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                className="h-8 text-xs"
                                placeholder="modelKey вручную"
                                value={row.model}
                                onChange={(e) =>
                                  updateRow(row.key, { model: e.target.value })
                                }
                              />
                            )}
                            {canSelectModel && (
                              <button
                                type="button"
                                className="mt-1 text-[11px] text-info hover:underline"
                                onClick={() =>
                                  updateRow(row.key, {
                                    manualModel: !row.manualModel,
                                  })
                                }
                              >
                                {row.manualModel
                                  ? "выбрать из каталога"
                                  : "или введите вручную"}
                              </button>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 text-xs text-fg-secondary">
                            Эффективно:{" "}
                            <span className="font-mono text-fg-primary">
                              {effectiveLabel(row)}
                            </span>
                          </div>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:bg-chip-danger-bg"
                            onClick={() => removeRow(row.key)}
                          >
                            <Trash2 size={12} /> Удалить
                          </Button>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3 border-t border-border-subtle pt-4">
            <div>
              <Label className="text-xs">
                Заметка о зафиксированной версии (опционально)
              </Label>
              <Input
                className="mt-1 text-sm"
                value={pinnedVersionNote}
                onChange={(e) => setPinnedVersionNote(e.target.value)}
                placeholder="Например: зафиксировано на время миграции провайдера"
              />
            </div>
            <div>
              <Label className="text-xs">Причина изменения*</Label>
              <Textarea
                className="mt-1 text-sm"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например: DeepSeek превысил лимит → переключаем на GPT-5.5"
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  "Сохранить"
                )}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
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
        <>
          <div className="mb-2 text-xs text-fg-secondary">
            Курс USD→RUB:{" "}
            <span className="font-mono text-fg-primary">
              {metrics.usdRubRate !== null
                ? metrics.usdRubRate.toFixed(2)
                : "недоступен — показываем в USD"}
            </span>
          </div>
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
                        {formatCostRub(row.costUsd, metrics.usdRubRate)}
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
                    {formatCostRub(metrics.totals.totalCostUsd, metrics.usdRubRate)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
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
