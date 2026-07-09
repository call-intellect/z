"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Search, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import {
  AI_MODELS_GROUPS,
  AI_MODELS_TIERS,
  adminAiModelsApi,
  type AiModelGroup,
  type AiModelTier,
  type BulkReassignAffectedApi,
  type BulkReassignScope,
} from "@/api/admin-ai-models.api";
import { adminLlmModelsApi } from "@/api/admin-llm-models.api";
import { adminLlmProvidersApi } from "@/api/admin-llm-providers.api";
import {
  mapTaskTypeRoute,
  providerLabel,
  type TaskTypeRouteUi,
} from "@/domain/admin-ai-model";
import { adminLlmModelFromApi } from "@/domain/admin-llm-model";
import { adminLlmProviderFromApi } from "@/domain/admin-llm-provider";
import { AdminSection } from "@/ui/components/admin/AdminSection";
import { SearchSelect } from "@/ui/components/admin/SearchSelect";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Textarea } from "@/ui/shadcn/textarea";
import { adminRootCrumb } from "@/ui/components/admin/brand";

import { AdminForbidden } from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

const ALL_TIERS = "all";

export function RoutingClient() {
  const [groupFilter, setGroupFilter] = useState<"all" | AiModelGroup>("all");
  const [search, setSearch] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const q = useAdminQuery<TaskTypeRouteUi[]>(
    `ai-models:${groupFilter}:${search}`,
    async () => {
      const res = await adminAiModelsApi.list({
        ...(groupFilter !== "all" ? { group: groupFilter } : {}),
        ...(search ? { search } : {}),
      });
      return res.items.map(mapTaskTypeRoute);
    },
    [groupFilter, search],
  );

  const items: TaskTypeRouteUi[] = useMemo(() => q.data ?? [], [q.data]);
  const loading = q.isLoading;
  const error = q.error;

  const grouped = useMemo(() => {
    const map = new Map<string, TaskTypeRouteUi[]>();
    for (const it of items) {
      const list = map.get(it.group) ?? [];
      list.push(it);
      map.set(it.group, list);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: "AI и модели" },
        { label: "Роутинг моделей" },
      ]}
      title="Роутинг моделей"
      description="Цепочка primary → secondary → tertiary для каждого taskType. Источник дефолтов — playbook §2.1."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <input
            type="text"
            placeholder="Поиск по taskType"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 rounded-md border border-border-subtle bg-bg-card pl-7 pr-3 text-sm"
          />
        </div>
        <Select
          value={groupFilter}
          onValueChange={(v) => setGroupFilter(v as "all" | AiModelGroup)}
        >
          <SelectTrigger className="h-9 w-56 bg-bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все группы</SelectItem>
            {AI_MODELS_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {g === "ai-pipeline"
                  ? "AI-конвейер встреч"
                  : g === "knowledge-core"
                    ? "База знаний"
                    : "Паритет с конкурентами"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setShowBulk(true)}
        >
          <Wand2 size={13} /> Балковое назначение
        </Button>
      </div>

      {showBulk && (
        <BulkReassignDialog
          onClose={() => setShowBulk(false)}
          onApplied={() => {
            setShowBulk(false);
            q.refetch();
          }}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-secondary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
        </div>
      )}

      {!loading && q.isForbidden && <AdminForbidden />}

      {!loading && !q.isForbidden && error && (
        <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          {error}
        </div>
      )}

      {!loading && !q.isForbidden && !error && items.length === 0 && (
        <div className="rounded-md border border-dashed border-border-subtle p-8 text-center text-sm text-fg-secondary">
          Пока нет ни одной записи. Запустите{" "}
          <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono">
            bun run scripts/seed-llm-task-routes-default.ts
          </code>{" "}
          на проде, чтобы применить дефолтные цепочки из playbook §2.1.
        </div>
      )}

      {grouped.map(([group, list]) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-fg-primary">
            {list[0]?.groupLabel ?? group}
            <span className="ml-2 text-xs font-normal text-fg-secondary">
              {list.length} агентов
            </span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Задача</th>
                  <th className="px-3 py-2 text-left font-medium">Основная</th>
                  <th className="px-3 py-2 text-left font-medium">Запасная</th>
                  <th className="px-3 py-2 text-left font-medium">Локальная</th>
                  <th className="w-24 px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr
                    key={row.taskType}
                    className="border-t border-border-subtle"
                  >
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-fg-secondary">
                        {row.taskType}
                      </code>
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge
                        color="green"
                        label="primary"
                        entry={row.primary}
                        effective={row.effectivePrimary}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge
                        color="orange"
                        label="secondary"
                        entry={row.secondary}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge
                        color="gray"
                        label="tertiary"
                        entry={row.tertiary}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/ai/routing/${encodeURIComponent(row.taskType)}`}
                        className="inline-flex items-center gap-1 text-xs text-info hover:underline"
                      >
                        Подробно <ExternalLink size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </AdminSection>
  );
}

function TierBadge({
  color,
  label,
  entry,
  effective,
}: {
  color: "green" | "orange" | "gray";
  label: string;
  entry: TaskTypeRouteUi["primary"];
  effective?: { providerName: string; model: string | null } | null;
}) {
  if (!entry) {
    if (effective) {
      return (
        <div className="flex flex-col gap-1">
          <Badge
            variant="outline"
            className="w-fit border border-border-subtle bg-bg-subtle text-[10px] text-fg-secondary"
          >
            {label} · по умолчанию
          </Badge>
          <div className="text-xs">
            <span className="font-medium text-fg-secondary">
              {providerLabel(effective.providerName)}
            </span>
            {effective.model && (
              <span className="ml-1 text-fg-tertiary">
                / {effective.model}
              </span>
            )}
          </div>
        </div>
      );
    }
    return <span className="text-xs text-fg-tertiary">— не задана —</span>;
  }
  const colorClass =
    color === "green"
      ? "bg-chip-success-bg text-chip-success-fg border-chip-success-bg"
      : color === "orange"
        ? "bg-chip-warning-bg text-chip-warning-fg border-chip-warning-bg"
        : "bg-bg-subtle text-fg-secondary border-border-subtle";
  return (
    <div className="flex flex-col gap-1">
      <Badge
        variant="outline"
        className={`w-fit border ${colorClass} text-[10px]`}
      >
        {label}
      </Badge>
      <div className="text-xs">
        <span className="font-medium text-fg-primary">
          {entry.providerLabel}
        </span>
        {entry.model && (
          <span className="ml-1 text-fg-secondary">/ {entry.model}</span>
        )}
      </div>
    </div>
  );
}

function BulkReassignDialog({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => void;
}) {
  const providersQ = useAdminQuery(
    "admin-llm-providers-for-bulk",
    async () => {
      const res = await adminLlmProvidersApi.list({ includeInactive: false });
      return res.items.map(adminLlmProviderFromApi);
    },
    [],
  );
  const modelsQ = useAdminQuery(
    "admin-llm-models-for-bulk",
    async () => {
      const res = await adminLlmModelsApi.list({ includeInactive: false });
      return res.items.map(adminLlmModelFromApi);
    },
    [],
  );

  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);
  const models = useMemo(() => modelsQ.data ?? [], [modelsQ.data]);

  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [];
    for (const p of providers) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      opts.push({ value: p.name, label: p.displayName });
    }
    return opts;
  }, [providers]);

  const [scope, setScope] = useState<BulkReassignScope>("unassigned");
  const [tier, setTier] = useState(ALL_TIERS);
  const [fromProviderName, setFromProviderName] = useState<string>("");
  const [toProviderName, setToProviderName] = useState<string>("");
  const [toModel, setToModel] = useState<string>("");
  const [reason, setReason] = useState("");
  const [affected, setAffected] = useState<BulkReassignAffectedApi[] | null>(
    null,
  );
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (providers.length === 0) return;
    seededRef.current = true;
    const first = providers[0];
    setFromProviderName(first.name);
    setToProviderName(first.name);
  }, [providers]);

  const toProvider = useMemo(
    () => providers.find((p) => p.name === toProviderName) ?? null,
    [providers, toProviderName],
  );
  const toModelOptions = useMemo(() => {
    if (!toProvider) return [];
    return models
      .filter((m) => m.providerId === toProvider.id)
      .map((m) => ({ value: m.modelKey, label: m.displayName }));
  }, [models, toProvider]);

  useEffect(() => {
    if (toModelOptions.length === 0) {
      setToModel("");
      return;
    }
    const defaultKey = toProvider?.defaultModelKey ?? null;
    const pick =
      (defaultKey && toModelOptions.some((m) => m.value === defaultKey)
        ? defaultKey
        : null) ?? toModelOptions[0].value;
    setToModel((prev) => (prev && toModelOptions.some((m) => m.value === prev) ? prev : pick));
  }, [toModelOptions, toProvider]);

  const handleToProviderChange = (next: string) => {
    setToProviderName(next);
    setAffected(null);
  };

  const handleFromProviderChange = (next: string) => {
    setFromProviderName(next);
    setAffected(null);
  };

  const tierValue = tier === ALL_TIERS ? undefined : (tier as AiModelTier);
  const catalogLoading = providersQ.isLoading || modelsQ.isLoading;

  const handlePreview = async () => {
    setPreviewing(true);
    setAffected(null);
    try {
      const res = await adminAiModelsApi.previewBulkReassign({
        scope,
        ...(tierValue ? { tier: tierValue } : {}),
        ...(scope === "provider" && fromProviderName
          ? { fromProviderName }
          : {}),
      });
      setAffected(res.affected);
      if (res.affected.length === 0) {
        toast.error("Ничего не найдено — маршрутов под эти условия нет");
      }
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось получить предпросмотр",
      );
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!toProviderName) {
      toast.error("Выберите провайдера назначения");
      return;
    }
    if (!toModel) {
      toast.error("Выберите модель назначения");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Укажите причину (не короче 3 символов)");
      return;
    }
    setApplying(true);
    try {
      const res = await adminAiModelsApi.bulkReassign({
        scope,
        ...(tierValue ? { tier: tierValue } : {}),
        ...(scope === "provider" && fromProviderName
          ? { fromProviderName }
          : {}),
        toProviderName,
        toModel,
        reason: reason.trim(),
      });
      toast.success(`Переключено маршрутов: ${res.updated}`);
      onApplied();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось применить изменение",
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Балковое назначение маршрутов</DialogTitle>
          <DialogDescription>
            Выставить провайдера/модель сразу на много (taskType, tier) —
            либо на все НЕ назначенные пары, либо на все пары, которые сейчас
            занимает один конкретный провайдер. Провайдеры и модели берутся из
            каталога. Сначала предпросмотр, потом применение.
          </DialogDescription>
        </DialogHeader>
        {catalogLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-fg-secondary">
            <Loader2 size={14} className="animate-spin" /> Загружаем каталог…
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-subtle p-4 text-sm text-fg-secondary">
            В каталоге нет активных провайдеров. Сначала добавьте провайдера и
            модели в разделе «Каталог».
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Что выбираем</Label>
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v as BulkReassignScope);
                  setAffected(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    Все НЕ назначенные (пустые) пары
                  </SelectItem>
                  <SelectItem value="provider">
                    Все пары на конкретном провайдере
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === "provider" && (
              <SearchSelect
                label="С провайдера (сейчас занят)"
                options={providerOptions}
                value={fromProviderName}
                onChange={handleFromProviderChange}
                placeholder="Выберите провайдера"
                emptyText="Нет провайдеров"
              />
            )}

            <div className="grid gap-1.5">
              <Label className="text-xs">Тир</Label>
              <Select
                value={tier}
                onValueChange={(v) => {
                  setTier(v);
                  setAffected(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TIERS}>Все тиры</SelectItem>
                  {AI_MODELS_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SearchSelect
                label="На провайдера"
                options={providerOptions}
                value={toProviderName}
                onChange={handleToProviderChange}
                placeholder="Выберите провайдера"
                emptyText="Нет провайдеров"
              />
              <SearchSelect
                label="Модель"
                options={toModelOptions}
                value={toModel}
                onChange={(v) => {
                  setToModel(v);
                  setAffected(null);
                }}
                placeholder={
                  toModelOptions.length === 0
                    ? "нет моделей в каталоге"
                    : "Выберите модель"
                }
                emptyText="У провайдера нет моделей в каталоге"
                disabled={toModelOptions.length === 0}
              />
            </div>

            <Button
              size="sm"
              variant="outline"
              disabled={previewing}
              onClick={() => void handlePreview()}
            >
              {previewing ? "Считаем…" : "Предпросмотр"}
            </Button>

            {affected !== null && (
              <div className="rounded-md border border-border-subtle bg-bg-subtle p-2">
                <div className="mb-1 text-xs font-medium text-fg-primary">
                  Затронет {affected.length}{" "}
                  {affected.length === 1 ? "маршрут" : "маршрутов"}
                </div>
                {affected.length > 0 && (
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-fg-secondary">
                    {affected.slice(0, 200).map((a) => (
                      <li key={`${a.taskType}::${a.tier}`} className="font-mono">
                        {a.taskType} / {a.tier}
                        {a.currentProviderName
                          ? ` (сейчас: ${a.currentProviderName}${a.currentModel ? `/${a.currentModel}` : ""})`
                          : " (сейчас: не задан)"}
                      </li>
                    ))}
                    {affected.length > 200 && (
                      <li>… и ещё {affected.length - 200}</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            <div className="grid gap-1.5">
              <Label className="text-xs">Причина изменения</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Зачем это делаем — попадёт в audit-лог"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={applying}>
            Отмена
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={
              applying ||
              catalogLoading ||
              providers.length === 0 ||
              !toModel ||
              affected === null ||
              affected.length === 0
            }
            onClick={() => void handleApply()}
          >
            {applying ? "Применяем…" : "Применить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
