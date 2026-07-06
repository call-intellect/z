"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Info, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminLlmModelsApi } from "@/api/admin-llm-models.api";
import { adminLlmProvidersApi } from "@/api/admin-llm-providers.api";
import {
  adminLlmModelFromApi,
  type AdminLlmModelDomain,
  type CreateLlmModelRequest,
  type ModelRemovalImpactApi,
} from "@/domain/admin-llm-model";
import {
  adminLlmProviderFromApi,
  type AdminLlmProviderDomain,
} from "@/domain/admin-llm-provider";
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

const ALL_PROVIDERS = "all";

type CategoryOption =
  | "none"
  | "flagship"
  | "fast"
  | "reasoning"
  | "embedding"
  | "experimental";

const CATEGORY_LABELS: Record<Exclude<CategoryOption, "none">, string> = {
  flagship: "Флагман",
  fast: "Быстрая",
  reasoning: "Рассуждающая",
  embedding: "Эмбеддинги",
  experimental: "Экспериментальная",
};

const CATEGORY_ORDER: Array<Exclude<CategoryOption, "none">> = [
  "flagship",
  "fast",
  "reasoning",
  "embedding",
  "experimental",
];

function categoryLabel(category: string | null): string {
  if (!category) return "—";
  return CATEGORY_LABELS[category as Exclude<CategoryOption, "none">] ?? category;
}

export function LlmModelsClient() {
  const searchParams = useSearchParams();
  const [providerFilter, setProviderFilter] = useState(
    searchParams?.get("providerId") ?? ALL_PROVIDERS,
  );
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editModel, setEditModel] = useState<AdminLlmModelDomain | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reassignDialog, setReassignDialog] =
    useState<AdminLlmModelDomain | null>(null);
  const [removalDialog, setRemovalDialog] = useState<{
    model: AdminLlmModelDomain;
    impact: ModelRemovalImpactApi;
  } | null>(null);

  const providersQ = useAdminQuery(
    "admin-llm-providers-for-models",
    async () => {
      const res = await adminLlmProvidersApi.list({ includeInactive: true });
      return res.items.map(adminLlmProviderFromApi);
    },
    [],
  );

  const q = useAdminQuery(
    `admin-llm-models:${providerFilter}:${includeInactive}`,
    async () => {
      const res = await adminLlmModelsApi.list({
        ...(providerFilter !== ALL_PROVIDERS
          ? { providerId: providerFilter }
          : {}),
        includeInactive,
      });
      return res.items.map(adminLlmModelFromApi);
    },
    [providerFilter, includeInactive],
  );

  const performSimpleDelete = async (m: AdminLlmModelDomain) => {
    setBusyId(m.id);
    try {
      const res = await adminLlmModelsApi.remove(m.id);
      toast.success(
        res.routesMigrated > 0
          ? `Модель «${m.displayName}» удалена, ${res.routesMigrated} маршрутов переключено`
          : `Модель «${m.displayName}» удалена`,
      );
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить модель",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (m: AdminLlmModelDomain) => {
    if (m.isDefault) {
      setReassignDialog(m);
      return;
    }
    setBusyId(m.id);
    let impact: ModelRemovalImpactApi;
    try {
      impact = await adminLlmModelsApi.previewRemoval(m.id);
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
    if (occupied && impact.currentDefaultModel) {
      setRemovalDialog({ model: m, impact });
      return;
    }
    if (occupied && !impact.currentDefaultModel) {
      toast.error(
        `Модель «${m.displayName}» занята в ${impact.affectedRoutesCount} маршрутах, а дефолтная модель у провайдера «${m.providerDisplayName}» ещё не назначена. Сначала нажмите «Сделать по умолчанию» у другой модели этого провайдера.`,
      );
      return;
    }

    if (!window.confirm(`Удалить модель «${m.displayName}»?`)) return;
    await performSimpleDelete(m);
  };

  const handleConfirmMigratedRemoval = async () => {
    if (!removalDialog) return;
    const { model, impact } = removalDialog;
    setBusyId(model.id);
    try {
      const res = await adminLlmModelsApi.remove(model.id);
      toast.success(
        res.routesMigrated > 0
          ? `Модель «${model.displayName}» удалена, ${res.routesMigrated} маршрутов переключено на ${impact.currentDefaultModel}`
          : `Модель «${model.displayName}» удалена`,
      );
      setRemovalDialog(null);
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить модель",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSetDefault = async (m: AdminLlmModelDomain) => {
    setBusyId(m.id);
    try {
      await adminLlmModelsApi.setDefault(m.id);
      toast.success(`«${m.displayName}» назначена дефолтной моделью провайдера`);
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Не удалось назначить модель по умолчанию",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleReassignRemoved = (
    routesMigrated: number,
    newDefaultModelKey: string,
  ) => {
    setReassignDialog(null);
    toast.success(
      routesMigrated > 0
        ? `Модель удалена, ${routesMigrated} маршрутов переключено на ${newDefaultModelKey}`
        : `Модель удалена, новая дефолтная модель — ${newDefaultModelKey}`,
    );
    q.refetch();
  };

  const providers = providersQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Модели LLM</h1>
          <p className="text-sm text-fg-tertiary">
            Реестр моделей по провайдерам. Для цен перейдите на «Цены».
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Добавить модель
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROVIDERS}>Все провайдеры</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Показать неактивные
        </label>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.length === 0 && (
        <AdminEmpty
          title="Моделей пока нет"
          description="Добавьте модель вручную или получите список через дискавери на карточке провайдера."
        />
      )}
      {!q.isLoading && q.data && q.data.length > 0 && (
        <ModelsTable
          items={q.data}
          busyId={busyId}
          onEdit={setEditModel}
          onDelete={(m) => void handleDelete(m)}
          onSetDefault={(m) => void handleSetDefault(m)}
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
                Удалить модель «{removalDialog.model.displayName}»?
              </DialogTitle>
              <DialogDescription>
                Эта модель сейчас используется в{" "}
                {removalDialog.impact.affectedRoutesCount} маршрутах. Все они
                переключатся на дефолтную модель провайдера:{" "}
                {removalDialog.impact.currentDefaultModel}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRemovalDialog(null)}
                disabled={busyId === removalDialog.model.id}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busyId === removalDialog.model.id}
                onClick={() => void handleConfirmMigratedRemoval()}
              >
                Удалить и переключить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {reassignDialog && (
        <ReassignDefaultModelDialog
          model={reassignDialog}
          otherModels={(q.data ?? []).filter(
            (x) =>
              x.id !== reassignDialog.id &&
              x.providerId === reassignDialog.providerId &&
              x.isActive,
          )}
          onClose={() => setReassignDialog(null)}
          onRemoved={handleReassignRemoved}
        />
      )}

      {showCreate && (
        <ModelFormDialog
          model={null}
          providers={providers}
          defaultProviderId={
            providerFilter !== ALL_PROVIDERS ? providerFilter : undefined
          }
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            q.refetch();
          }}
        />
      )}
      {editModel && (
        <ModelFormDialog
          model={editModel}
          providers={providers}
          onClose={() => setEditModel(null)}
          onSaved={() => {
            setEditModel(null);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

function ModelsTable({
  items,
  busyId,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  items: AdminLlmModelDomain[];
  busyId: string | null;
  onEdit: (m: AdminLlmModelDomain) => void;
  onDelete: (m: AdminLlmModelDomain) => void;
  onSetDefault: (m: AdminLlmModelDomain) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Провайдер</th>
            <th className="px-3 py-2 text-left">Model key</th>
            <th className="px-3 py-2 text-left">Отображение</th>
            <th className="px-3 py-2 text-left">Категория</th>
            <th className="px-3 py-2 text-right">Контекст (tokens)</th>
            <th className="px-3 py-2 text-left">Статус</th>
            <th className="px-3 py-2 text-left">Verified</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr
              key={m.id}
              className="border-t border-border-subtle hover:bg-bg-overlay"
            >
              <td className="px-3 py-2 font-mono text-xs">{m.providerName}</td>
              <td className="px-3 py-2 font-mono text-xs">{m.modelKey}</td>
              <td className="px-3 py-2">{m.displayName}</td>
              <td className="px-3 py-2 text-xs">{categoryLabel(m.category)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {m.contextWindow
                  ? m.contextWindow.toLocaleString("ru-RU")
                  : "—"}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {m.isActive ? (
                    <Badge variant="default">активна</Badge>
                  ) : (
                    <Badge variant="secondary">отключена</Badge>
                  )}
                  {m.isDefault && (
                    <Badge variant="default">
                      <Star size={11} /> По умолчанию
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs">
                {m.verifiedAt ? (
                  m.verifiedAt.toLocaleDateString("ru-RU")
                ) : (
                  <span className="text-fg-tertiary">не проверена</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {!m.isDefault && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === m.id}
                      onClick={() => onSetDefault(m)}
                    >
                      <Star size={12} /> Сделать по умолчанию
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === m.id}
                    onClick={() => onEdit(m)}
                  >
                    <Pencil size={12} /> Изменить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === m.id}
                    onClick={() => onDelete(m)}
                  >
                    <Trash2 size={12} /> Удалить
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        {tooltip && (
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
        )}
      </div>
      {children}
      {hint && <span className="text-[11px] text-fg-tertiary">{hint}</span>}
    </div>
  );
}

function ModelFormDialog({
  model,
  providers,
  defaultProviderId,
  onClose,
  onSaved,
}: {
  model: AdminLlmModelDomain | null;
  providers: AdminLlmProviderDomain[];
  defaultProviderId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = model !== null;
  const [providerId, setProviderId] = useState(
    model?.providerId ?? defaultProviderId ?? providers[0]?.id ?? "",
  );
  const [modelKey, setModelKey] = useState(model?.modelKey ?? "");
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [contextWindow, setContextWindow] = useState(
    model?.contextWindow !== null && model?.contextWindow !== undefined
      ? String(model.contextWindow)
      : "",
  );
  const [category, setCategory] = useState<CategoryOption>(
    (model?.category as CategoryOption) ?? "none",
  );
  const [isActive, setIsActive] = useState(model?.isActive ?? true);
  const [notes, setNotes] = useState(model?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!isEdit) {
      if (!providerId) {
        toast.error("Выберите провайдера");
        return;
      }
      if (!modelKey.trim()) {
        toast.error("Укажите идентификатор модели");
        return;
      }
    }
    if (!displayName.trim()) {
      toast.error("Укажите отображаемое имя модели");
      return;
    }
    let contextWindowValue: number | undefined;
    if (contextWindow.trim().length > 0) {
      const c = Number(contextWindow);
      if (!Number.isInteger(c) || c <= 0) {
        toast.error("Контекстное окно — целое число > 0");
        return;
      }
      contextWindowValue = c;
    }

    setSubmitting(true);
    try {
      if (isEdit && model) {
        await adminLlmModelsApi.update(model.id, {
          displayName: displayName.trim(),
          contextWindow: contextWindowValue,
          category: category === "none" ? undefined : category,
          isActive,
          notes: notes.trim().length > 0 ? notes.trim() : undefined,
        });
      } else {
        const body: CreateLlmModelRequest = {
          providerId,
          modelKey: modelKey.trim(),
          displayName: displayName.trim(),
          isActive,
        };
        if (contextWindowValue !== undefined) {
          body.contextWindow = contextWindowValue;
        }
        if (category !== "none") body.category = category;
        if (notes.trim().length > 0) body.notes = notes.trim();
        await adminLlmModelsApi.create(body);
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
            {isEdit
              ? `Провайдер: ${model?.providerDisplayName}. Идентификатор модели изменить нельзя.`
              : "Идентификатор модели и провайдер после создания не меняются."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!isEdit && (
            <Field
              label="Провайдер"
              tooltip="Провайдер LLM, к которому относится модель. После создания изменить нельзя."
            >
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите провайдера" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {!isEdit && (
            <Field
              label="Идентификатор модели (modelKey)"
              hint="Передаётся в запросе к API провайдера. Изменить позже нельзя."
              tooltip="Идентификатор модели в API провайдера — эта строка передаётся в запросе как есть."
            >
              <Input
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                placeholder="gpt-5-mini"
              />
            </Field>
          )}
          <Field
            label="Отображаемое имя"
            tooltip="Человекочитаемое имя модели, которое видно в интерфейсе."
          >
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Контекстное окно (tokens)"
              hint="Необязательно."
              tooltip="Размер контекстного окна модели в токенах."
            >
              <Input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="необязательно"
              />
            </Field>
            <Field
              label="Категория"
              tooltip="Категория модели для интерфейса: флагман, быстрая, рассуждающая, эмбеддинги или экспериментальная."
            >
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as CategoryOption)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не задана</SelectItem>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            label="Активна"
            tooltip="Участвует ли модель в маршрутизации запросов."
          >
            <div className="flex h-9 items-center">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </Field>
          <Field
            label="Заметки"
            tooltip="Свободная заметка о статусе модели — например, об ограничениях или проблемах."
          >
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
            disabled={submitting || (!isEdit && !providerId)}
          >
            {submitting ? "Сохраняем…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDefaultModelDialog({
  model,
  otherModels,
  onClose,
  onRemoved,
}: {
  model: AdminLlmModelDomain;
  otherModels: AdminLlmModelDomain[];
  onClose: () => void;
  onRemoved: (routesMigrated: number, newDefaultModelKey: string) => void;
}) {
  const [newModelId, setNewModelId] = useState(otherModels[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!newModelId && otherModels.length > 0) {
      setNewModelId(otherModels[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherModels]);

  const handleConfirm = async () => {
    const newModel = otherModels.find((m) => m.id === newModelId);
    if (!newModel) {
      toast.error("Выберите новую дефолтную модель");
      return;
    }
    setSubmitting(true);
    try {
      const res = await adminLlmModelsApi.remove(model.id, newModel.modelKey);
      onRemoved(res.routesMigrated, newModel.modelKey);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Не удалось удалить модель",
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
            Удалить модель «{model.displayName}» (сейчас — по умолчанию)?
          </DialogTitle>
          <DialogDescription>
            «{model.displayName}» сейчас назначена дефолтной моделью
            провайдера «{model.providerDisplayName}». Чтобы удалить её,
            сначала выбери, какая модель станет новой дефолтной.
          </DialogDescription>
        </DialogHeader>
        {otherModels.length === 0 ? (
          <p className="text-xs text-danger">
            У провайдера «{model.providerDisplayName}» нет других активных
            моделей — сначала добавьте ещё одну, чтобы было на что
            переключить дефолт.
          </p>
        ) : (
          <div className="grid gap-3">
            <Field label="Новая дефолтная модель">
              <Select value={newModelId} onValueChange={setNewModelId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {otherModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName} ({m.modelKey})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            disabled={submitting || otherModels.length === 0 || !newModelId}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Удаляем…" : "Назначить и удалить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
