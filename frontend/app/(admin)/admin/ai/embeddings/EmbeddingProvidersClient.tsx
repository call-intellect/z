"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Plus,
  Power,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminEmbeddingProvidersApi } from "@/api/admin-embedding-providers.api";
import {
  adminEmbeddingProviderFromApi,
  type AdminEmbeddingModelDomain,
  type AdminEmbeddingProviderDomain,
  type CreateEmbeddingModelRequest,
  type CreateEmbeddingProviderRequest,
  type EmbeddingProtocolKind,
} from "@/domain/admin-embedding-provider";
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
import { Switch } from "@/ui/shadcn/switch";
import { Textarea } from "@/ui/shadcn/textarea";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "../../AdminStateViews";
import { useAdminQuery } from "../../useAdminQuery";

const PROTOCOL_LABELS: Record<EmbeddingProtocolKind, string> = {
  "openai-embeddings": "OpenAI-совместимый (/embeddings)",
  "ollama-embeddings": "Ollama (/api/embeddings)",
};

function formatPriceRub(kopecks: number | null): string {
  if (kopecks === null) return "—";
  return `${(kopecks / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

type ModelDialogState = {
  provider: AdminEmbeddingProviderDomain;
  model: AdminEmbeddingModelDomain | null;
};

export function EmbeddingProvidersClient() {
  const [showCreate, setShowCreate] = useState(false);
  const [editProvider, setEditProvider] =
    useState<AdminEmbeddingProviderDomain | null>(null);
  const [modelDialog, setModelDialog] = useState<ModelDialogState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useAdminQuery(
    "admin-embedding-providers",
    async () => {
      const res = await adminEmbeddingProvidersApi.list({
        includeInactive: true,
      });
      return res.items.map(adminEmbeddingProviderFromApi);
    },
    [],
  );

  const handleActivate = async (p: AdminEmbeddingProviderDomain) => {
    setBusyId(p.id);
    try {
      await adminEmbeddingProvidersApi.activate(p.id);
      toast.success(`Провайдер «${p.displayName}» активирован`);
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось активировать провайдера",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSmoke = async (p: AdminEmbeddingProviderDomain) => {
    setBusyId(p.id);
    try {
      const r = await adminEmbeddingProvidersApi.smoke(p.id);
      if (r.ok) toast.success(`Smoke «${p.displayName}»: успешно`);
      else toast.error(`Smoke «${p.displayName}»: ${r.error ?? "ошибка"}`);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка smoke-проверки");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (p: AdminEmbeddingProviderDomain) => {
    if (
      !window.confirm(
        `Удалить провайдера «${p.displayName}»? Он больше не будет участвовать в расчёте эмбеддингов.`,
      )
    ) {
      return;
    }
    setBusyId(p.id);
    try {
      await adminEmbeddingProvidersApi.remove(p.id);
      toast.success(`Провайдер «${p.displayName}» удалён`);
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить провайдера",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteModel = async (
    provider: AdminEmbeddingProviderDomain,
    model: AdminEmbeddingModelDomain,
  ) => {
    if (!window.confirm(`Удалить модель «${model.displayName}»?`)) return;
    setBusyId(model.id);
    try {
      await adminEmbeddingProvidersApi.removeModel(provider.id, model.id);
      toast.success(`Модель «${model.displayName}» удалена`);
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить модель",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Провайдеры эмбеддингов</h1>
          <p className="text-sm text-fg-tertiary">
            Адрес API, ключ, модели с размерностью и справочной ценой, порядок
            fallback и smoke-проверка. Активные провайдеры используются в порядке
            приоритета (меньше — раньше).
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
          description="Добавьте первого провайдера эмбеддингов, чтобы система могла рассчитывать векторы без правки конфигурации на сервере."
        />
      )}
      {!q.isLoading && q.data && q.data.length > 0 && (
        <div className="space-y-4">
          {q.data.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              busy={busyId === p.id}
              busyModelId={busyId}
              onActivate={() => void handleActivate(p)}
              onSmoke={() => void handleSmoke(p)}
              onEdit={() => setEditProvider(p)}
              onDelete={() => void handleDelete(p)}
              onAddModel={() => setModelDialog({ provider: p, model: null })}
              onEditModel={(m) => setModelDialog({ provider: p, model: m })}
              onDeleteModel={(m) => void handleDeleteModel(p, m)}
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
          }}
        />
      )}
      {modelDialog && (
        <ModelFormDialog
          providerId={modelDialog.provider.id}
          providerName={modelDialog.provider.displayName}
          model={modelDialog.model}
          onClose={() => setModelDialog(null)}
          onSaved={() => {
            setModelDialog(null);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  busyModelId,
  onActivate,
  onSmoke,
  onEdit,
  onDelete,
  onAddModel,
  onEditModel,
  onDeleteModel,
}: {
  provider: AdminEmbeddingProviderDomain;
  busy: boolean;
  busyModelId: string | null;
  onActivate: () => void;
  onSmoke: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddModel: () => void;
  onEditModel: (m: AdminEmbeddingModelDomain) => void;
  onDeleteModel: (m: AdminEmbeddingModelDomain) => void;
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
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-tertiary">
            <span className="break-all font-mono">{provider.baseUrl}</span>
            <span>протокол: {provider.protocolKind}</span>
            <span>приоритет: {provider.priority}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!provider.isActive && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onActivate}
            >
              <Power size={12} /> Активировать
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={onSmoke}>
            <Zap size={12} /> Smoke
          </Button>
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

      {provider.needsReindex && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Требуется реиндексация: у провайдера сменились модель или размерность
            вектора. Пока пересчёт не выполнен, поиск по векторам может работать
            некорректно.
          </span>
        </div>
      )}

      <div className="mt-3 text-xs">
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
      </div>

      <div className="mt-4 rounded-md border border-border-subtle">
        <div className="flex items-center justify-between border-b border-border-subtle bg-bg-overlay px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Модели
          </span>
          <Button size="sm" variant="ghost" onClick={onAddModel}>
            <Plus size={12} /> Добавить модель
          </Button>
        </div>
        {provider.models.length === 0 ? (
          <p className="px-3 py-3 text-xs text-fg-tertiary">
            У провайдера нет моделей. Добавьте хотя бы одну.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {provider.models.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-fg-primary">
                      {m.displayName}
                    </span>
                    <span className="font-mono text-xs text-fg-tertiary">
                      {m.modelKey}
                    </span>
                    {m.isActive ? (
                      <Badge variant="success">активна</Badge>
                    ) : (
                      <Badge variant="secondary">отключена</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-fg-tertiary">
                    <span>размерность: {m.dimensions}</span>
                    <span>
                      цена за 1M токенов:{" "}
                      {formatPriceRub(m.pricePerMillionInputTokensKopecks)}
                    </span>
                    {m.notes && <span className="break-all">{m.notes}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyModelId === m.id}
                    onClick={() => onEditModel(m)}
                  >
                    <Pencil size={12} /> Изменить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyModelId === m.id}
                    onClick={() => onDeleteModel(m)}
                  >
                    <Trash2 size={12} /> Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
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
}: {
  provider: AdminEmbeddingProviderDomain | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = provider !== null;
  const [name, setName] = useState(provider?.name ?? "");
  const [displayName, setDisplayName] = useState(provider?.displayName ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [protocolKind, setProtocolKind] = useState<EmbeddingProtocolKind>(
    (provider?.protocolKind as EmbeddingProtocolKind) ?? "openai-embeddings",
  );
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(String(provider?.priority ?? 100));
  const [isActive, setIsActive] = useState(provider?.isActive ?? true);
  const [headers, setHeaders] = useState(
    provider?.defaultHeaders
      ? JSON.stringify(provider.defaultHeaders, null, 2)
      : "",
  );
  const [submitting, setSubmitting] = useState(false);

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
    const prio = Number(priority);
    if (!Number.isInteger(prio) || prio < 0) {
      toast.error("Приоритет — целое число ≥ 0");
      return;
    }
    let parsedHeaders: Record<string, string> | null | undefined;
    try {
      parsedHeaders = parseHeaders(headers);
    } catch {
      toast.error("HTTP-заголовки: некорректный JSON (объект строка→строка)");
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && provider) {
        await adminEmbeddingProvidersApi.update(provider.id, {
          displayName: displayName.trim(),
          baseUrl: baseUrl.trim(),
          protocolKind,
          priority: prio,
          isActive,
          ...(apiKey.length > 0 ? { apiKey } : {}),
          ...(parsedHeaders !== undefined
            ? { defaultHeaders: parsedHeaders }
            : {}),
        });
      } else {
        const body: CreateEmbeddingProviderRequest = {
          name,
          displayName: displayName.trim(),
          baseUrl: baseUrl.trim(),
          protocolKind,
          priority: prio,
          isActive,
        };
        if (apiKey.length > 0) body.apiKey = apiKey;
        if (parsedHeaders !== undefined) body.defaultHeaders = parsedHeaders;
        await adminEmbeddingProvidersApi.create(body);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Редактировать провайдера" : "Новый провайдер эмбеддингов"}
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
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="custom-embeddings"
              />
            </Field>
          )}
          <Field label="Отображаемое имя">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Мой провайдер эмбеддингов"
            />
          </Field>
          <Field label="Адрес API">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1/embeddings"
            />
          </Field>
          <Field label="Тип протокола">
            <Select
              value={protocolKind}
              onValueChange={(v) =>
                setProtocolKind(v as EmbeddingProtocolKind)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-embeddings">
                  {PROTOCOL_LABELS["openai-embeddings"]}
                </SelectItem>
                <SelectItem value="ollama-embeddings">
                  {PROTOCOL_LABELS["ollama-embeddings"]}
                </SelectItem>
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
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? "оставьте пустым, чтобы не менять" : ""}
              autoComplete="new-password"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Приоритет" hint="Меньше — раньше в fallback-цепочке.">
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </Field>
            <Field label="Активен">
              <div className="flex h-9 items-center">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </Field>
          </div>
          <Field
            label="Доп. HTTP-заголовки (JSON)"
            hint='Необязательно. Пример: {"X-Custom": "value"}'
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

function ModelFormDialog({
  providerId,
  providerName,
  model,
  onClose,
  onSaved,
}: {
  providerId: string;
  providerName: string;
  model: AdminEmbeddingModelDomain | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = model !== null;
  const [modelKey, setModelKey] = useState(model?.modelKey ?? "");
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [dimensions, setDimensions] = useState(
    model ? String(model.dimensions) : "",
  );
  const [priceRub, setPriceRub] = useState(
    model && model.pricePerMillionInputTokensKopecks !== null
      ? String(model.pricePerMillionInputTokensKopecks / 100)
      : "",
  );
  const [isActive, setIsActive] = useState(model?.isActive ?? true);
  const [notes, setNotes] = useState(model?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!isEdit && !modelKey.trim()) {
      toast.error("Укажите идентификатор модели");
      return;
    }
    if (!displayName.trim()) {
      toast.error("Укажите отображаемое имя модели");
      return;
    }
    const dims = Number(dimensions);
    if (!Number.isInteger(dims) || dims < 64 || dims > 4096) {
      toast.error("Размерность — целое число от 64 до 4096");
      return;
    }
    let kopecks: number | null = null;
    if (priceRub.trim().length > 0) {
      const rub = Number(priceRub);
      if (!Number.isFinite(rub) || rub < 0) {
        toast.error("Цена — неотрицательное число в рублях");
        return;
      }
      kopecks = Math.round(rub * 100);
    }

    setSubmitting(true);
    try {
      if (isEdit && model) {
        await adminEmbeddingProvidersApi.updateModel(providerId, model.id, {
          displayName: displayName.trim(),
          dimensions: dims,
          pricePerMillionInputTokensKopecks: kopecks,
          isActive,
          notes: notes.trim().length > 0 ? notes.trim() : null,
        });
      } else {
        const body: CreateEmbeddingModelRequest = {
          modelKey: modelKey.trim(),
          displayName: displayName.trim(),
          dimensions: dims,
          isActive,
        };
        if (kopecks !== null) body.pricePerMillionInputTokensKopecks = kopecks;
        if (notes.trim().length > 0) body.notes = notes.trim();
        await adminEmbeddingProvidersApi.addModel(providerId, body);
      }
      toast.success(isEdit ? "Модель сохранена" : "Модель добавлена");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось сохранить");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Редактировать модель" : "Новая модель"}
          </DialogTitle>
          <DialogDescription>
            Провайдер: {providerName}. Размерность должна совпадать с текущей
            размерностью pgvector-колонок для активации.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!isEdit && (
            <Field
              label="Идентификатор модели"
              hint="Передаётся в запросе к API. Изменить позже нельзя."
            >
              <Input
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                placeholder="text-embedding-3-small"
              />
            </Field>
          )}
          <Field label="Отображаемое имя">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Размерность вектора" hint="От 64 до 4096.">
              <Input
                type="number"
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder="768"
              />
            </Field>
            <Field
              label="Цена за 1M токенов (₽)"
              hint="Справочно. Не влияет на биллинг."
            >
              <Input
                type="number"
                step="0.01"
                value={priceRub}
                onChange={(e) => setPriceRub(e.target.value)}
                placeholder="необязательно"
              />
            </Field>
          </div>
          <Field label="Активна">
            <div className="flex h-9 items-center">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </Field>
          <Field label="Заметки">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="необязательно"
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
