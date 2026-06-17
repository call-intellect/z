"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { adminFeatureFlagsApi } from "@/api/admin-feature-flags.api";
import { adminOrgsApi } from "@/api/admin-orgs.api";
import { ApiError } from "@/api/api-error";
import {
  type FeatureFlagDomain,
  FEATURE_FLAG_CATEGORIES,
} from "@/domain/admin-feature-flag";
import { adminOrgListFromApi } from "@/domain/admin-org";
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

import { useAdminQuery } from "../../useAdminQuery";

type Props = {
  flag: FeatureFlagDomain | null;
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

type OverrideRow = { id: string; orgId: string; value: boolean };

const KEY_REGEX = /^[a-z0-9_.-]{2,64}$/i;
const MIN_REASON_LENGTH = 10;

export function FlagEditDialog({
  flag,
  mode,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = mode === "edit" && flag !== null;

  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(
    FEATURE_FLAG_CATEGORIES[0]?.value ?? "ai",
  );
  const [defaultValue, setDefaultValue] = useState(false);
  const [rolloutPercent, setRolloutPercent] = useState<string>("");
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgsQuery = useAdminQuery(
    open ? "admin-flags-orgs" : "",
    async () => {
      const res = await adminOrgsApi.list({ limit: 200 });
      return adminOrgListFromApi(res);
    },
    [open],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReason("");
    if (isEdit && flag) {
      setKey(flag.key);
      setDescription(flag.description);
      setCategory(flag.category);
      setDefaultValue(flag.defaultValue);
      setRolloutPercent(
        flag.rolloutPercent === null ? "" : String(flag.rolloutPercent),
      );
      setOverrides(
        Object.entries(flag.orgOverrides ?? {}).map(([orgId, value]) => ({
          id: rowId(),
          orgId,
          value,
        })),
      );
    } else {
      setKey("");
      setDescription("");
      setCategory(FEATURE_FLAG_CATEGORIES[0]?.value ?? "ai");
      setDefaultValue(false);
      setRolloutPercent("");
      setOverrides([]);
    }
  }, [open, isEdit, flag]);

  const keyValid = useMemo(() => KEY_REGEX.test(key.trim()), [key]);
  const descriptionValid = description.trim().length >= 1;
  const rolloutValid = useMemo(() => {
    if (rolloutPercent.trim() === "") return true;
    const n = Number(rolloutPercent);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, [rolloutPercent]);
  const canSave = descriptionValid && rolloutValid && (isEdit || keyValid);

  const addOverride = () => {
    setOverrides((prev) => [...prev, { id: rowId(), orgId: "", value: true }]);
  };

  const updateOverride = (id: string, patch: Partial<OverrideRow>) => {
    setOverrides((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  const removeOverride = (id: string) => {
    setOverrides((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSave = async () => {
    if (saving) return;
    setError(null);

    const overridesMap: Record<string, boolean> = {};
    const seen = new Set<string>();
    for (const row of overrides) {
      const id = row.orgId.trim();
      if (!id) continue;
      if (seen.has(id)) {
        setError(`Org «${id}» указана дважды — оставьте одну запись.`);
        return;
      }
      seen.add(id);
      overridesMap[id] = row.value;
    }

    const rollout =
      rolloutPercent.trim() === "" ? null : Math.floor(Number(rolloutPercent));

    setSaving(true);
    try {
      if (!isEdit) {
        await adminFeatureFlagsApi.create({
          key: key.trim(),
          description: description.trim(),
          category,
          defaultValue,
          orgOverrides: overridesMap,
          rolloutPercent: rollout,
          reason: reason.trim() || undefined,
        });
        toast.success(`Флаг «${key.trim()}» создан`);
      } else {
        await adminFeatureFlagsApi.update(flag!.key, {
          description: description.trim(),
          category,
          defaultValue,
          orgOverrides: overridesMap,
          rolloutPercent: rollout,
          reason: reason.trim() || undefined,
        });
        toast.success(`Флаг «${flag!.key}» обновлён`);
      }
      onSaved();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Редактировать «${flag!.key}»` : "Новый feature flag"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Изменения немедленно применяются во всех процессах. Org-overrides перекрывают defaultValue."
              : "Ключ нельзя поменять после создания. Используйте формат snake_case с точками: `ai.copilot.enabled`."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="flag-key">
                  Ключ <span className="text-danger">*</span>
                </Label>
                <Input
                  id="flag-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="ai.copilot.enabled"
                  className="font-mono text-xs"
                  disabled={isEdit || saving}
                />
                {!isEdit && key.length > 0 && !keyValid ? (
                  <p className="text-[11px] text-danger">
                    Только латиница, цифры, точка и подчёркивание. От 2 до 64
                    символов.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="flag-category">Категория</Label>
                <Select value={category} onValueChange={(v) => setCategory(v)}>
                  <SelectTrigger id="flag-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEATURE_FLAG_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="flag-description">
                Описание <span className="text-danger">*</span>
              </Label>
              <Textarea
                id="flag-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Что включает / выключает этот флаг."
                rows={2}
                disabled={saving}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2">
                <Switch
                  checked={defaultValue}
                  onCheckedChange={(v) => setDefaultValue(v)}
                  disabled={saving}
                  aria-label="Глобальный дефолт"
                />
                <div className="min-w-0 text-xs">
                  <p className="font-medium text-fg-primary">
                    Глобальный default: {defaultValue ? "вкл" : "выкл"}
                  </p>
                  <p className="text-fg-tertiary">
                    Используется для Org, у которых нет override.
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="flag-rollout">Rollout %, опц.</Label>
                <Input
                  id="flag-rollout"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={rolloutPercent}
                  onChange={(e) => setRolloutPercent(e.target.value)}
                  placeholder="например, 25"
                  disabled={saving}
                />
                {!rolloutValid ? (
                  <p className="text-[11px] text-danger">
                    Должно быть число от 0 до 100.
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <OverridesSection
            rows={overrides}
            orgs={
              orgsQuery.data?.items.map((o) => ({
                id: o.id,
                name: o.name,
              })) ?? null
            }
            onAdd={addOverride}
            onUpdate={updateOverride}
            onRemove={removeOverride}
            disabled={saving}
          />

          <div className="space-y-1">
            <Label htmlFor="flag-reason">
              Причина изменения
              <span className="ml-1 text-[11px] text-fg-tertiary">
                (опц., но обязательна на бэке для severity high)
              </span>
            </Label>
            <Textarea
              id="flag-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Можно оставить пустым; для критичных флагов добавьте мин. ${MIN_REASON_LENGTH} символов.`}
              rows={2}
              disabled={saving}
            />
          </div>

          {error ? (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={saving || !canSave}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 size={13} className="mr-1 animate-spin" aria-hidden />
            ) : (
              <Save size={13} className="mr-1" aria-hidden />
            )}
            {isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OverridesSection({
  rows,
  orgs,
  onAdd,
  onUpdate,
  onRemove,
  disabled,
}: {
  rows: OverrideRow[];
  orgs: Array<{ id: string; name: string }> | null;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<OverrideRow>) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border-subtle p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-fg-primary">Org-overrides</h3>
          <p className="text-xs text-fg-tertiary">
            Индивидуальное значение для конкретной Org. Перекрывает default.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={disabled}
        >
          <Plus size={13} aria-hidden className="mr-1" />
          Добавить
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Пока нет override'ов — все Org получат глобальный default.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <OverrideRowEditor
              key={r.id}
              row={r}
              orgs={orgs}
              onChange={(patch) => onUpdate(r.id, patch)}
              onRemove={() => onRemove(r.id)}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OverrideRowEditor({
  row,
  orgs,
  onChange,
  onRemove,
  disabled,
}: {
  row: OverrideRow;
  orgs: Array<{ id: string; name: string }> | null;
  onChange: (patch: Partial<OverrideRow>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      {orgs && orgs.length > 0 ? (
        <Select
          value={row.orgId}
          onValueChange={(v) => onChange({ orgId: v })}
          disabled={disabled}
        >
          <SelectTrigger className="min-w-[200px] flex-1 font-mono text-xs">
            <SelectValue placeholder="выберите Org" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                <span className="font-mono text-xs">{o.id}</span>
                <span className="ml-2 text-fg-tertiary">— {o.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={row.orgId}
          onChange={(e) => onChange({ orgId: e.target.value })}
          placeholder="tenantId (например, tenant_xxx)"
          className="flex-1 font-mono text-xs"
          disabled={disabled}
        />
      )}
      <div className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-1.5">
        <Switch
          checked={row.value}
          onCheckedChange={(v) => onChange({ value: v })}
          disabled={disabled}
        />
        <span className="text-xs text-fg-secondary">
          {row.value ? "вкл" : "выкл"}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={disabled}
        className="text-danger hover:bg-danger/10"
        title="Удалить override"
      >
        <Trash2 size={13} aria-hidden />
      </Button>
    </li>
  );
}

function rowId(): string {
  if (
    typeof globalThis !== "undefined" &&
    "crypto" in globalThis &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `row_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
