"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Info,
  Pencil,
  Plus,
  Power,
  Star,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminLlmModelsApi } from "@/api/admin-llm-models.api";
import { adminLlmProvidersApi } from "@/api/admin-llm-providers.api";
import {
  adminLlmProviderFromApi,
  type AdminLlmProviderDomain,
  type CreateLlmProviderRequest,
  type LlmProtocolKind,
  type LlmProviderCapability,
  type RemovalImpactApi,
} from "@/domain/admin-llm-provider";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
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
import { Switch } from "@/ui/shadcn/switch";
import { Textarea } from "@/ui/shadcn/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/shadcn/tooltip";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";
import {
  notifyCatalogChange,
  useCatalogRefresh,
} from "./useCatalogRefresh";

const PROTOCOL_LABELS: Record<LlmProtocolKind, string> = {
  "openai-chat": "OpenAI Chat Completions (/v1/chat/completions)",
  "openai-responses": "OpenAI Responses (/v1/responses)",
  "anthropic-messages": "Anthropic Messages (/v1/messages)",
  "ollama-native": "Ollama (OpenAI-совместимый)",
  "kie-native": "KIE (мультиформатный: claude-*/gpt-*/gemini-*)",
  "grsai-native": "GRSAI",
  "custom-http": "Custom HTTP (generic)",
};

const PROTOCOL_ORDER: LlmProtocolKind[] = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "ollama-native",
  "kie-native",
  "grsai-native",
  "custom-http",
];

const CAPABILITY_LABELS: Record<LlmProviderCapability, string> = {
  public: "Публичные данные",
  internal: "Внутренние",
  sensitive: "Чувствительные",
  private: "Приватные (self-hosted)",
};

const CAPABILITY_ORDER: LlmProviderCapability[] = [
  "public",
  "internal",
  "sensitive",
  "private",
];

function protocolLabel(kind: string): string {
  return PROTOCOL_LABELS[kind as LlmProtocolKind] ?? kind;
}

function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability as LlmProviderCapability] ?? capability;
}

export function LlmProvidersClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [editProvider, setEditProvider] =
    useState<AdminLlmProviderDomain | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [defaultDialogProvider, setDefaultDialogProvider] =
    useState<AdminLlmProviderDomain | null>(null);
  const [reassignDialog, setReassignDialog] =
    useState<AdminLlmProviderDomain | null>(null);
  const [removalDialog, setRemovalDialog] = useState<{
    provider: AdminLlmProviderDomain;
    impact: RemovalImpactApi;
  } | null>(null);

  const q = useAdminQuery(
    "admin-llm-providers",
    async () => {
      const res = await adminLlmProvidersApi.list({ includeInactive: true });
      return res.items.map(adminLlmProviderFromApi);
    },
    [],
  );

  useCatalogRefresh("providers", () => q.refetch());

  const goToModels = (providerId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("tab", "models");
    next.set("providerId", providerId);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const handleToggleActive = async (p: AdminLlmProviderDomain) => {
    setBusyId(p.id);
    try {
      await adminLlmProvidersApi.update(p.id, { isActive: !p.isActive });
      toast.success(
        p.isActive
          ? `Провайдер «${p.displayName}» деактивирован`
          : `Провайдер «${p.displayName}» активирован`,
      );
      q.refetch();
      notifyCatalogChange("providers");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось изменить статус провайдера",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSmoke = async (p: AdminLlmProviderDomain) => {
    setBusyId(p.id);
    try {
      const r = await adminLlmProvidersApi.smokeTest(p.id);
      const message = `${p.displayName}: ${
        r.success ? "успех" : `провал — ${r.error ?? "неизвестная ошибка"}`
      } (${r.durationSeconds.toFixed(2)} с)`;
      if (r.success) toast.success(message);
      else toast.error(message);
      q.refetch();
      notifyCatalogChange("providers");
      notifyCatalogChange("smoke");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка smoke-теста");
    } finally {
      setBusyId(null);
    }
  };

  const performSimpleDelete = async (p: AdminLlmProviderDomain) => {
    setBusyId(p.id);
    try {
      const res = await adminLlmProvidersApi.remove(p.id);
      toast.success(
        res.routesMigrated > 0
          ? `Провайдер «${p.displayName}» удалён, ${res.routesMigrated} маршрутов переключено`
          : `Провайдер «${p.displayName}» удалён`,
      );
      q.refetch();
      notifyCatalogChange("providers");
      notifyCatalogChange("prices");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить провайдера",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (p: AdminLlmProviderDomain) => {
    if (p.isDefaultProvider) {
      setReassignDialog(p);
      return;
    }
    setBusyId(p.id);
    let impact: RemovalImpactApi;
    try {
      impact = await adminLlmProvidersApi.previewRemoval(p.id);
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Не удалось получить информацию об удалении",
      );
      setBusyId(null);
      return;
    }
    setBusyId(null);

    const occupied = impact.affectedRoutesCount > 0 || impact.inDefaultChain;
    if (occupied && impact.currentDefault) {
      setRemovalDialog({ provider: p, impact });
      return;
    }
    if (occupied && !impact.currentDefault) {
      toast.error(
        `Провайдер «${p.displayName}» занят в ${impact.affectedRoutesCount} маршрутах, а провайдер по умолчанию ещё не назначен. Сначала нажмите «Сделать по умолчанию» у другого провайдера — тогда удаление автоматически переключит маршруты на него.`,
      );
      return;
    }

    if (
      !window.confirm(
        `Удалить провайдера «${p.displayName}»? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }
    await performSimpleDelete(p);
  };

  const handleConfirmMigratedRemoval = async () => {
    if (!removalDialog) return;
    const { provider, impact } = removalDialog;
    setBusyId(provider.id);
    try {
      const res = await adminLlmProvidersApi.remove(provider.id);
      const defaultLabel = impact.currentDefault
        ? `${impact.currentDefault.providerName}${
            impact.currentDefault.model ? ` / ${impact.currentDefault.model}` : ""
          }`
        : "";
      toast.success(
        res.routesMigrated > 0
          ? `Провайдер «${provider.displayName}» удалён, ${res.routesMigrated} маршрутов переключено на ${defaultLabel}`
          : `Провайдер «${provider.displayName}» удалён`,
      );
      setRemovalDialog(null);
      q.refetch();
      notifyCatalogChange("providers");
      notifyCatalogChange("prices");
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить провайдера",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleReassignRemoved = (
    routesMigrated: number,
    newDefaultName: string,
  ) => {
    setReassignDialog(null);
    toast.success(
      routesMigrated > 0
        ? `Провайдер удалён, ${routesMigrated} маршрутов переключено на ${newDefaultName}`
        : `Провайдер удалён, новый провайдер по умолчанию — ${newDefaultName}`,
    );
    q.refetch();
    notifyCatalogChange("providers");
    notifyCatalogChange("prices");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Провайдеры LLM</h1>
          <p className="text-sm text-fg-tertiary">
            Адрес API, ключ, протокол, прокси, модель по умолчанию и
            smoke-проверка. Реестр — боевой источник подключений для всех
            LLM-вызовов.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Добавить провайдера
        </Button>
      </div>

      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.length === 0 && (
        <AdminEmpty
          title="Провайдеров пока нет"
          description="Добавьте первого провайдера, чтобы система могла вызывать LLM без правки конфигурации на сервере."
        />
      )}
      {!q.isLoading && q.data && q.data.length > 0 && (
        <div className="space-y-4">
          {q.data.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              busy={busyId === p.id}
              onToggleActive={() => void handleToggleActive(p)}
              onSmoke={() => void handleSmoke(p)}
              onEdit={() => setEditProvider(p)}
              onDelete={() => void handleDelete(p)}
              onSetDefault={() => setDefaultDialogProvider(p)}
              onGoToModels={() => goToModels(p.id)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <ProviderFormDialog
          provider={null}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            q.refetch();
            notifyCatalogChange("providers");
          }}
          onModelsImported={() => {
            q.refetch();
            notifyCatalogChange("providers");
            notifyCatalogChange("models");
          }}
        />
      )}
      {editProvider && (
        <ProviderFormDialog
          provider={editProvider}
          onClose={() => setEditProvider(null)}
          onSaved={() => {
            setEditProvider(null);
            q.refetch();
            notifyCatalogChange("providers");
          }}
          onModelsImported={() => {
            q.refetch();
            notifyCatalogChange("providers");
            notifyCatalogChange("models");
          }}
        />
      )}
      {defaultDialogProvider && (
        <SetDefaultDialog
          provider={defaultDialogProvider}
          onClose={() => setDefaultDialogProvider(null)}
          onSaved={() => {
            setDefaultDialogProvider(null);
            q.refetch();
          }}
        />
      )}
      {removalDialog && (
        <Dialog
          open
          onOpenChange={(o) => (!o ? setRemovalDialog(null) : undefined)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Удалить провайдера «{removalDialog.provider.displayName}»?
              </DialogTitle>
              <DialogDescription>
                Этот провайдер сейчас используется в{" "}
                {removalDialog.impact.affectedRoutesCount} маршрутах. Все они
                переключатся на провайдера по умолчанию:{" "}
                {removalDialog.impact.currentDefault?.providerName}
                {removalDialog.impact.currentDefault?.model
                  ? ` / ${removalDialog.impact.currentDefault.model}`
                  : ""}
                .
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRemovalDialog(null)}
                disabled={busyId === removalDialog.provider.id}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busyId === removalDialog.provider.id}
                onClick={() => void handleConfirmMigratedRemoval()}
              >
                Удалить и переключить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {reassignDialog && (
        <ReassignDefaultDialog
          provider={reassignDialog}
          otherProviders={(q.data ?? []).filter(
            (x) => x.id !== reassignDialog.id && x.isActive,
          )}
          onClose={() => setReassignDialog(null)}
          onRemoved={handleReassignRemoved}
        />
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onToggleActive,
  onSmoke,
  onEdit,
  onDelete,
  onSetDefault,
  onGoToModels,
}: {
  provider: AdminLlmProviderDomain;
  busy: boolean;
  onToggleActive: () => void;
  onSmoke: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onGoToModels: () => void;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-fg-primary">
              {provider.displayName}
            </span>
            <span className="font-mono text-xs text-fg-tertiary">
              {provider.name}
            </span>
            {provider.isDefaultProvider && (
              <Badge variant="default">
                <Star size={11} /> По умолчанию
              </Badge>
            )}
            {provider.billingMode === "subscription" && (
              <Badge variant="outline">
                по подписке
                {provider.subscriptionMonthlyCostUsd !== null
                  ? `: $${provider.subscriptionMonthlyCostUsd}/мес`
                  : ""}
              </Badge>
            )}
            {provider.isActive ? (
              <Badge variant="success">активен</Badge>
            ) : (
              <Badge variant="secondary">отключён</Badge>
            )}
            {provider.hasApiKey ? (
              <Badge variant="outline">ключ задан</Badge>
            ) : (
              <Badge variant="secondary">без ключа</Badge>
            )}
            {provider.useProxy && (
              <Badge variant="outline">
                через прокси{provider.proxyPath ? `: ${provider.proxyPath}` : ""}
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-tertiary">
            <span className="break-all font-mono">{provider.baseUrl}</span>
            <span>протокол: {protocolLabel(provider.protocolKind)}</span>
            <span>класс данных: {capabilityLabel(provider.capability)}</span>
            {provider.defaultModelKey && (
              <span>
                модель по умолчанию:{" "}
                <span className="font-mono">{provider.defaultModelKey}</span>
              </span>
            )}
            {provider.globalRps !== null && (
              <span>лимит: {provider.globalRps} rps</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onSmoke}>
            <Zap size={12} /> Smoke
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onToggleActive}
          >
            <Power size={12} />{" "}
            {provider.isActive ? "Деактивировать" : "Активировать"}
          </Button>
          {!provider.isDefaultProvider && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onSetDefault}
            >
              <Star size={12} /> Сделать по умолчанию
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
            <Pencil size={12} /> Редактировать
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 size={12} /> Удалить
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        {provider.lastSmokeAt ? (
          <span className="flex items-center gap-1.5">
            {provider.lastSmokeSuccess ? (
              <CheckCircle2 size={13} className="text-success" />
            ) : (
              <XCircle size={13} className="text-danger" />
            )}
            <span className="text-fg-tertiary">
              Последняя проверка: {provider.lastSmokeAt.toLocaleString("ru-RU")}
            </span>
            {!provider.lastSmokeSuccess && provider.lastSmokeError && (
              <span className="text-danger">— {provider.lastSmokeError}</span>
            )}
          </span>
        ) : (
          <span className="text-fg-tertiary">Smoke-проверка не запускалась</span>
        )}
        <Button size="sm" variant="ghost" onClick={onGoToModels}>
          Модели провайдера <ArrowRight size={12} />
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  tooltip,
  children,
}: {
  label: string;
  hint?: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs">{label}</Label>
        {tooltip ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger
                type="button"
                tabIndex={-1}
                className="text-fg-tertiary"
              >
                <Info size={13} />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {children}
      {hint && <span className="text-[11px] text-fg-tertiary">{hint}</span>}
    </div>
  );
}

function parseHeaders(raw: string): Record<string, string> | null | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error("headers");
  }
  return parsed as Record<string, string>;
}

function ProviderFormDialog({
  provider,
  onClose,
  onSaved,
  onModelsImported,
}: {
  provider: AdminLlmProviderDomain | null;
  onClose: () => void;
  onSaved: () => void;
  onModelsImported: () => void;
}) {
  const isEdit = provider !== null;
  const [name, setName] = useState(provider?.name ?? "");
  const [displayName, setDisplayName] = useState(provider?.displayName ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [protocolKind, setProtocolKind] = useState<LlmProtocolKind>(
    (provider?.protocolKind as LlmProtocolKind) ?? "openai-chat",
  );
  const [capability, setCapability] = useState<LlmProviderCapability>(
    (provider?.capability as LlmProviderCapability) ?? "public",
  );
  const [apiKey, setApiKey] = useState("");
  const [useProxy, setUseProxy] = useState(provider?.useProxy ?? false);
  const [proxyPath, setProxyPath] = useState(provider?.proxyPath ?? "");
  const [timeoutMs, setTimeoutMs] = useState(
    provider?.timeoutMs !== null && provider?.timeoutMs !== undefined
      ? String(provider.timeoutMs)
      : "",
  );
  const [defaultModelKey, setDefaultModelKey] = useState(
    provider?.defaultModelKey ?? "",
  );
  const [globalRps, setGlobalRps] = useState(
    provider?.globalRps !== null && provider?.globalRps !== undefined
      ? String(provider.globalRps)
      : "",
  );
  const [isActive, setIsActive] = useState(provider?.isActive ?? true);
  const [billingMode, setBillingMode] = useState<"per_token" | "subscription">(
    provider?.billingMode === "subscription" ? "subscription" : "per_token",
  );
  const [subscriptionMonthlyCostUsd, setSubscriptionMonthlyCostUsd] = useState(
    provider?.subscriptionMonthlyCostUsd !== null &&
      provider?.subscriptionMonthlyCostUsd !== undefined
      ? String(provider.subscriptionMonthlyCostUsd)
      : "",
  );
  const [subscriptionStartedAt, setSubscriptionStartedAt] = useState(
    provider?.subscriptionStartedAt
      ? provider.subscriptionStartedAt.toISOString().slice(0, 10)
      : "",
  );
  const [headers, setHeaders] = useState(
    provider?.defaultHeaders
      ? JSON.stringify(provider.defaultHeaders, null, 2)
      : "",
  );
  const [submitting, setSubmitting] = useState(false);

  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{
    id: string;
    alreadyInCatalog: boolean;
  }> | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    new Set(),
  );
  const [importing, setImporting] = useState(false);

  const [existingModels, setExistingModels] = useState<
    Array<{ id: string; modelKey: string }>
  >([]);
  const [pendingModels, setPendingModels] = useState<string[]>([]);
  const [newModelKey, setNewModelKey] = useState("");
  const [addingModel, setAddingModel] = useState(false);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void adminLlmModelsApi
      .list({ providerId: provider.id, includeInactive: true })
      .then((res) => {
        if (!cancelled) {
          setExistingModels(
            res.items.map((m) => ({ id: m.id, modelKey: m.modelKey })),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const handleAddModel = async () => {
    const key = newModelKey.trim();
    if (!key) return;
    if (
      pendingModels.includes(key) ||
      existingModels.some((m) => m.modelKey === key)
    ) {
      toast.error("Такая модель уже есть в списке");
      return;
    }
    if (!isEdit || !provider) {
      setPendingModels((prev) => [...prev, key]);
      setNewModelKey("");
      return;
    }
    setAddingModel(true);
    try {
      const created = await adminLlmModelsApi.create({
        providerId: provider.id,
        modelKey: key,
        displayName: key,
        isActive: true,
      });
      setExistingModels((prev) => [
        ...prev,
        { id: created.id, modelKey: created.modelKey },
      ]);
      setNewModelKey("");
      onModelsImported();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось добавить модель",
      );
    } finally {
      setAddingModel(false);
    }
  };

  const discoveryDisabled = !isEdit || protocolKind === "anthropic-messages";

  const handleDiscover = async () => {
    if (!provider) return;
    setDiscovering(true);
    try {
      const res = await adminLlmProvidersApi.discoverModels(provider.id);
      if (res.ok) {
        setDiscoveredModels(res.models);
        setSelectedModelIds(
          new Set(res.models.filter((m) => !m.alreadyInCatalog).map((m) => m.id)),
        );
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось получить список моделей",
      );
    } finally {
      setDiscovering(false);
    }
  };

  const handleImportSelected = async () => {
    if (!provider || !discoveredModels) return;
    const toImport = discoveredModels.filter(
      (m) => selectedModelIds.has(m.id) && !m.alreadyInCatalog,
    );
    if (toImport.length === 0) {
      toast.error("Выберите хотя бы одну новую модель для импорта");
      return;
    }
    setImporting(true);
    try {
      await Promise.all(
        toImport.map((m) =>
          adminLlmModelsApi.create({
            providerId: provider.id,
            modelKey: m.id,
            displayName: m.id,
            isActive: true,
          }),
        ),
      );
      toast.success(`Импортировано моделей: ${toImport.length}`);
      setDiscoveredModels((prev) =>
        prev
          ? prev.map((m) =>
              selectedModelIds.has(m.id) ? { ...m, alreadyInCatalog: true } : m,
            )
          : prev,
      );
      setSelectedModelIds(new Set());
      onModelsImported();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось импортировать модели",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = async () => {
    if (!isEdit && !/^[a-z0-9-]+$/.test(name)) {
      toast.error("Идентификатор: только строчные латинские буквы, цифры и дефис");
      return;
    }
    if (!displayName.trim()) {
      toast.error("Укажите отображаемое имя");
      return;
    }
    if (!baseUrl.trim()) {
      toast.error("Укажите адрес API");
      return;
    }
    let parsedHeaders: Record<string, string> | null | undefined;
    try {
      parsedHeaders = parseHeaders(headers);
    } catch {
      toast.error("HTTP-заголовки: некорректный JSON (объект строка→строка)");
      return;
    }
    let timeoutMsValue: number | null = null;
    if (timeoutMs.trim().length > 0) {
      const t = Number(timeoutMs);
      if (!Number.isInteger(t) || t <= 0) {
        toast.error("Таймаут — целое число мс > 0");
        return;
      }
      timeoutMsValue = t;
    }
    let globalRpsValue: number | undefined;
    if (globalRps.trim().length > 0) {
      const r = Number(globalRps);
      if (!Number.isInteger(r) || r <= 0) {
        toast.error("Лимит rps — целое число > 0");
        return;
      }
      globalRpsValue = r;
    }
    let subscriptionMonthlyCostValue: number | null = null;
    if (billingMode === "subscription") {
      const c = Number(subscriptionMonthlyCostUsd);
      if (!subscriptionMonthlyCostUsd.trim() || !isFinite(c) || c < 0) {
        toast.error("Сумма подписки в месяц — число ≥ 0");
        return;
      }
      if (!subscriptionStartedAt) {
        toast.error("Укажите дату начала подписки");
        return;
      }
      subscriptionMonthlyCostValue = c;
    }

    setSubmitting(true);
    try {
      const commonFields = {
        displayName: displayName.trim(),
        baseUrl: baseUrl.trim(),
        protocolKind,
        capability,
        isActive,
        useProxy,
        proxyPath: proxyPath.trim().length > 0 ? proxyPath.trim() : null,
        timeoutMs: timeoutMsValue,
        defaultModelKey:
          defaultModelKey.trim().length > 0 ? defaultModelKey.trim() : null,
        billingMode,
        subscriptionMonthlyCostUsd: subscriptionMonthlyCostValue,
        subscriptionStartedAt:
          billingMode === "subscription"
            ? new Date(`${subscriptionStartedAt}T00:00:00.000Z`).toISOString()
            : null,
        ...(globalRpsValue !== undefined ? { globalRps: globalRpsValue } : {}),
        ...(parsedHeaders ? { defaultHeaders: parsedHeaders } : {}),
      };
      if (isEdit && provider) {
        await adminLlmProvidersApi.update(provider.id, {
          ...commonFields,
          ...(apiKey.length > 0 ? { apiKey } : {}),
        });
      } else {
        const body: CreateLlmProviderRequest = {
          name,
          ...commonFields,
        };
        if (apiKey.length > 0) body.apiKey = apiKey;
        const created = await adminLlmProvidersApi.create(body);
        if (pendingModels.length > 0) {
          const failed: string[] = [];
          for (const key of pendingModels) {
            try {
              await adminLlmModelsApi.create({
                providerId: created.id,
                modelKey: key,
                displayName: key,
                isActive: true,
              });
            } catch {
              failed.push(key);
            }
          }
          if (failed.length > 0) {
            toast.error(`Модели не добавлены: ${failed.join(", ")}`);
          }
          if (failed.length < pendingModels.length) {
            onModelsImported();
          }
        }
      }
      toast.success(isEdit ? "Провайдер сохранён" : "Провайдер создан");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Редактировать провайдера" : "Новый провайдер LLM"}
          </DialogTitle>
          <DialogDescription>
            Адрес API и ключ хранятся зашифрованными. Ключ не отображается — при
            редактировании оставьте поле пустым, чтобы не менять его.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!isEdit && (
            <Field
              label="Идентификатор (slug)"
              hint="Стабильный ключ: строчные латиница, цифры, дефис. Изменить позже нельзя."
              tooltip="Уникальное короткое имя провайдера (slug), например «deepseek» или «openai-proxy». Используется в коде как стабильный идентификатор — менять после создания нельзя."
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-llm-provider"
              />
            </Field>
          )}
          <Field
            label="Отображаемое имя"
            tooltip="Человекочитаемое имя провайдера — отображается в интерфейсе админки."
          >
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Мой провайдер"
            />
          </Field>
          <Field
            label="Адрес API (baseUrl)"
            tooltip="Базовый адрес API провайдера — куда система отправляет запросы (endpoint)."
          >
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field
            label="Тип протокола"
            tooltip="Формат протокола: как система формирует запрос и разбирает ответ этого провайдера (openai-chat / openai-responses / anthropic-messages / ollama-native / kie-native / grsai-native / custom-http)."
          >
            <Select
              value={protocolKind}
              onValueChange={(v) => setProtocolKind(v as LlmProtocolKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOL_ORDER.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {PROTOCOL_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Класс данных (capability)"
            tooltip="Влияет на маршрутизацию запросов по dataClass через LlmRouterService: «sensitive»/«private» допускаются для чувствительных данных, «public» — только для не чувствительных."
          >
            <Select
              value={capability}
              onValueChange={(v) => setCapability(v as LlmProviderCapability)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPABILITY_ORDER.map((cap) => (
                  <SelectItem key={cap} value={cap}>
                    {CAPABILITY_LABELS[cap]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="API-ключ"
            hint={
              isEdit
                ? "Оставьте пустым, чтобы не менять текущий ключ."
                : "Необязательно для self-hosted без авторизации."
            }
            tooltip="Хранится в зашифрованном виде (AES-256-GCM). Можно оставить пустым для self-hosted провайдеров без авторизации (например, Ollama)."
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? "оставьте пустым, чтобы не менять" : ""}
              autoComplete="new-password"
            />
          </Field>
          <div className="rounded-md border border-border-subtle p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs">
                    {useProxy ? "Через прокси" : "Напрямую"}
                  </Label>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        tabIndex={-1}
                        className="text-fg-tertiary"
                      >
                        <Info size={13} />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Ходить к провайдеру через внутренний прокси: итоговый
                        адрес строится из PROXY_BASE_URL и пути на прокси, а
                        ключ передаётся с префиксом PROXY_PREFIX.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <p className="text-[11px] text-fg-tertiary">
                  Ходить к провайдеру через внутренний прокси вместо прямого
                  подключения.
                </p>
              </div>
              <Switch checked={useProxy} onCheckedChange={setUseProxy} />
            </div>
            {useProxy && (
              <div className="mt-3">
                <Field
                  label="Путь на прокси (proxyPath)"
                  hint="Слаг пути на прокси, например 'grsai'. Пусто — корневой прокси (для OpenAI)."
                  tooltip="Слаг пути на прокси — добавляется к адресу прокси, например «grsai» → адрес-прокси/grsai/v1. Пусто — используется корневой upstream-прокси (для OpenAI)."
                >
                  <Input
                    value={proxyPath}
                    onChange={(e) => setProxyPath(e.target.value)}
                    placeholder="необязательно"
                  />
                </Field>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Таймаут (мс)"
              hint="Переопределение таймаута dispatch. Пусто = глобальный дефолт."
              tooltip="Переопределяет глобальный таймаут запроса к провайдеру (в мс). Если не задано — используется общий дефолт из настроек (LLM_ROUTER_DISPATCH_TIMEOUT_MS)."
            >
              <Input
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                placeholder="необязательно"
              />
            </Field>
            <Field
              label="Лимит запросов (rps)"
              hint="Необязательно."
              tooltip="Ограничение частоты запросов к провайдеру (запросов в секунду) для самозащиты от перегрузки. Если не задано — лимита нет."
            >
              <Input
                type="number"
                value={globalRps}
                onChange={(e) => setGlobalRps(e.target.value)}
                placeholder="необязательно"
              />
            </Field>
          </div>
          <Field
            label="Модель по умолчанию"
            hint="Используется, когда модель не задали ни вызов, ни маршрут."
            tooltip="Модель, которая используется, если ни сам вызов, ни маршрут не указали конкретную модель явно."
          >
            <div className="flex gap-2">
              <Input
                value={defaultModelKey}
                onChange={(e) => setDefaultModelKey(e.target.value)}
                placeholder="например, gpt-5-mini"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={discoveryDisabled || discovering}
                onClick={() => void handleDiscover()}
                title={
                  protocolKind === "anthropic-messages"
                    ? "Anthropic Messages API не поддерживает автополучение моделей"
                    : !isEdit
                      ? "Сначала сохраните провайдера"
                      : undefined
                }
              >
                {discovering ? "Получаем…" : "Получить"}
              </Button>
            </div>
            {discoveredModels && (
              <div className="mt-2 rounded-md border border-border-subtle p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-fg-tertiary">
                    Найдено моделей: {discoveredModels.length}. Нажмите на
                    название, чтобы подставить её как модель по умолчанию.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={importing}
                    onClick={() => void handleImportSelected()}
                  >
                    {importing ? "Импортируем…" : "Импортировать выбранные"}
                  </Button>
                </div>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {discoveredModels.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={selectedModelIds.has(m.id)}
                        disabled={m.alreadyInCatalog}
                        onCheckedChange={(checked) => {
                          setSelectedModelIds((prev) => {
                            const next = new Set(prev);
                            if (checked === true) next.add(m.id);
                            else next.delete(m.id);
                            return next;
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="truncate font-mono text-fg-primary hover:underline"
                        onClick={() => setDefaultModelKey(m.id)}
                      >
                        {m.id}
                      </button>
                      {m.alreadyInCatalog && (
                        <Badge variant="secondary">уже в каталоге</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Field>
          <Field
            label="Модели"
            hint="Ключ модели — как в API провайдера. Для Anthropic-совместимых автополучение недоступно — добавляйте вручную."
            tooltip="Модели этого провайдера в каталоге: их можно выбирать в маршрутах задач и заводить на них цены. При создании провайдера модели будут созданы вместе с ним."
          >
            <div className="space-y-2">
              {(existingModels.length > 0 || pendingModels.length > 0) && (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {existingModels.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-xs">
                      <span className="truncate font-mono text-fg-primary">
                        {m.modelKey}
                      </span>
                      <Badge variant="secondary">в каталоге</Badge>
                    </li>
                  ))}
                  {pendingModels.map((key) => (
                    <li key={key} className="flex items-center gap-2 text-xs">
                      <span className="truncate font-mono text-fg-primary">
                        {key}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setPendingModels((prev) =>
                            prev.filter((k) => k !== key),
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  value={newModelKey}
                  onChange={(e) => setNewModelKey(e.target.value)}
                  placeholder="ключ модели, например MiniMax-M3"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddModel();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={addingModel || newModelKey.trim().length === 0}
                  onClick={() => void handleAddModel()}
                >
                  <Plus size={13} />
                  Добавить модель
                </Button>
              </div>
              {pendingModels.length > 0 && !isEdit && (
                <p className="text-[11px] text-fg-tertiary">
                  Модели будут созданы в каталоге вместе с провайдером.
                </p>
              )}
            </div>
          </Field>
          <Field
            label="Активен"
            tooltip="Определяет, участвует ли провайдер в маршрутизации запросов. Отключённый провайдер не будет выбран для новых вызовов."
          >
            <div className="flex h-9 items-center">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </Field>
          <Field
            label="Тип тарификации"
            tooltip="«По токенам» — обычная оплата за использованные токены (нужен прайс в разделе «Цены»). «По подписке» — фиксированная сумма в месяц, вызовы через этот провайдер всегда стоят $0 (токены всё равно считаются для аналитики)."
          >
            <Select
              value={billingMode}
              onValueChange={(v) => setBillingMode(v as "per_token" | "subscription")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_token">По токенам</SelectItem>
                <SelectItem value="subscription">По подписке</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {billingMode === "subscription" && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Сумма подписки в месяц (USD)"
                tooltip="Сколько платим провайдеру раз в месяц. Раз в месяц, в день годовщины даты начала, эта сумма попадёт в общий дашборд расхода как реальное списание."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={subscriptionMonthlyCostUsd}
                  onChange={(e) => setSubscriptionMonthlyCostUsd(e.target.value)}
                  placeholder="50.00"
                />
              </Field>
              <Field
                label="Дата начала подписки"
                tooltip="Определяет день месяца, когда фиксируется списание (с учётом коротких месяцев)."
              >
                <Input
                  type="date"
                  value={subscriptionStartedAt}
                  onChange={(e) => setSubscriptionStartedAt(e.target.value)}
                />
              </Field>
            </div>
          )}
          <Field
            label="Доп. HTTP-заголовки (JSON)"
            hint='Необязательно. Пример: {"X-Custom": "value"}'
            tooltip="Дополнительные HTTP-заголовки, отправляемые с каждым запросом к этому провайдеру (например, Anthropic-Version). Формат — JSON-объект строка→строка."
          >
            <Textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={2}
              placeholder="{}"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? "Сохраняем…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetDefaultDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: AdminLlmProviderDomain;
  onClose: () => void;
  onSaved: () => void;
}) {
  const modelsQ = useAdminQuery(
    `admin-llm-models-for-default-${provider.id}`,
    async () => {
      const res = await adminLlmModelsApi.list({
        providerId: provider.id,
        includeInactive: false,
      });
      return res.items;
    },
    [provider.id],
  );
  const models = modelsQ.data ?? [];
  const [selectedModel, setSelectedModel] = useState(
    provider.defaultModelKey ?? "",
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models[0].modelKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const handleConfirm = async () => {
    if (!selectedModel) {
      toast.error("Выберите модель");
      return;
    }
    setSubmitting(true);
    try {
      await adminLlmProvidersApi.setDefault(provider.id, selectedModel);
      toast.success(
        `«${provider.displayName}» назначен провайдером по умолчанию`,
      );
      onSaved();
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Не удалось назначить провайдера по умолчанию",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Сделать провайдера «{provider.displayName}» дефолтным?
          </DialogTitle>
          <DialogDescription>
            На него будут автоматически переключаться маршруты при удалении
            других занятых провайдеров.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Модель по умолчанию">
            {modelsQ.isLoading ? (
              <span className="text-xs text-fg-tertiary">
                Загружаем модели…
              </span>
            ) : models.length === 0 ? (
              <span className="text-xs text-danger">
                У провайдера нет активных моделей в каталоге — сначала
                добавьте модель.
              </span>
            ) : (
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.modelKey}>
                      {m.displayName} ({m.modelKey})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={submitting || models.length === 0}
          >
            {submitting ? "Назначаем…" : "Назначить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDefaultDialog({
  provider,
  otherProviders,
  onClose,
  onRemoved,
}: {
  provider: AdminLlmProviderDomain;
  otherProviders: AdminLlmProviderDomain[];
  onClose: () => void;
  onRemoved: (routesMigrated: number, newDefaultName: string) => void;
}) {
  const [newProviderId, setNewProviderId] = useState(
    otherProviders[0]?.id ?? "",
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const modelsQ = useAdminQuery(
    `admin-llm-models-for-reassign-${newProviderId}`,
    async () => {
      if (!newProviderId) return [];
      const res = await adminLlmModelsApi.list({
        providerId: newProviderId,
        includeInactive: false,
      });
      return res.items;
    },
    [newProviderId],
  );
  const models = modelsQ.data ?? [];

  useEffect(() => {
    setSelectedModel("");
  }, [newProviderId]);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models[0].modelKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const handleConfirm = async () => {
    if (!newProviderId || !selectedModel) {
      toast.error("Выберите нового провайдера по умолчанию и модель");
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminLlmProvidersApi.remove(provider.id, {
        providerId: newProviderId,
        model: selectedModel,
      });
      const newDefault = otherProviders.find((p) => p.id === newProviderId);
      onRemoved(res.routesMigrated, newDefault?.displayName ?? selectedModel);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить провайдера",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Удалить провайдера «{provider.displayName}» (сейчас — по
            умолчанию)?
          </DialogTitle>
          <DialogDescription>
            «{provider.displayName}» сейчас назначен провайдером по умолчанию.
            Чтобы удалить его, сначала выбери, кто станет новым провайдером по
            умолчанию.
          </DialogDescription>
        </DialogHeader>
        {otherProviders.length === 0 ? (
          <p className="text-xs text-danger">
            Нет других активных провайдеров — сначала добавьте ещё одного,
            чтобы было на кого переключить дефолт.
          </p>
        ) : (
          <div className="grid gap-3">
            <Field label="Новый провайдер по умолчанию">
              <Select value={newProviderId} onValueChange={setNewProviderId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {otherProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Модель">
              {modelsQ.isLoading ? (
                <span className="text-xs text-fg-tertiary">
                  Загружаем модели…
                </span>
              ) : models.length === 0 ? (
                <span className="text-xs text-danger">
                  У выбранного провайдера нет активных моделей в каталоге.
                </span>
              ) : (
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.modelKey}>
                        {m.displayName} ({m.modelKey})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={
              submitting ||
              otherProviders.length === 0 ||
              !newProviderId ||
              !selectedModel
            }
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Удаляем…" : "Назначить и удалить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
