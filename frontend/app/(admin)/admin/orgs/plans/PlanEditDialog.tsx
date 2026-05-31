'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminPlansApi } from '@/api/admin-plans.api';
import type {
  CreatePlanRequest,
  PlanFeaturesMap,
  PlanItemDomain,
  PlanQuotasMap,
  UpdatePlanRequest,
} from '@/domain/admin-plan';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

type Props = {
  /** При null — диалог в режиме «создать». Иначе — «редактировать» этот план. */
  plan: PlanItemDomain | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Колбэк после успешного save — родитель должен пере-загрузить список. */
  onSaved: () => void;
};

type FeatureRow = { id: string; key: string; value: boolean };
type QuotaRow = { id: string; key: string; value: string };

/**
 * Диалог редактирования / создания Plan.
 *
 * 3 секции:
 *   - Базовое (id / displayName / description / monthlyPriceRub / sortOrder).
 *     `id` редактируем только при создании; в режиме edit — read-only.
 *   - Фичи: динамическая таблица key → boolean.
 *   - Лимиты: динамическая таблица key → number (хранится строкой в форме,
 *     приводится к числу при save; пустое поле пропускается).
 *
 * При save отправляет POST или PATCH в зависимости от режима. На стороне
 * родителя — refetch списка.
 */
export function PlanEditDialog({ plan, open, onOpenChange, onSaved }: Props) {
  const isEdit = plan !== null;

  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [monthlyPriceRub, setMonthlyPriceRub] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('0');
  const [isActive, setIsActive] = useState(true);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сброс / инициализация формы при открытии диалога.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (plan) {
      setId(plan.id);
      setDisplayName(plan.displayName);
      setDescription(plan.description ?? '');
      setMonthlyPriceRub(
        plan.monthlyPriceRub === null ? '' : String(plan.monthlyPriceRub),
      );
      setSortOrder(String(plan.sortOrder));
      setIsActive(plan.isActive);
      setFeatures(featuresMapToRows(plan.features));
      setQuotas(quotasMapToRows(plan.quotas));
    } else {
      setId('');
      setDisplayName('');
      setDescription('');
      setMonthlyPriceRub('');
      setSortOrder('0');
      setIsActive(true);
      setFeatures([]);
      setQuotas([]);
    }
  }, [open, plan]);

  const idValid = useMemo(
    () => /^[a-z0-9_]{2,64}$/i.test(id.trim()),
    [id],
  );
  const displayNameValid = displayName.trim().length >= 1;
  const canSave = displayNameValid && (isEdit || idValid);

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const featuresMap: PlanFeaturesMap = {};
      for (const row of features) {
        const key = row.key.trim();
        if (!key) continue;
        featuresMap[key] = row.value;
      }
      const quotasMap: PlanQuotasMap = {};
      for (const row of quotas) {
        const key = row.key.trim();
        if (!key) continue;
        if (row.value === '') continue;
        const num = Number(row.value);
        if (!Number.isFinite(num)) {
          throw new Error(`Лимит «${key}» — некорректное число: ${row.value}`);
        }
        quotasMap[key] = num;
      }

      if (!isEdit) {
        const body: CreatePlanRequest = {
          id: id.trim(),
          displayName: displayName.trim(),
          features: featuresMap,
          quotas: quotasMap,
        };
        if (description.trim()) body.description = description.trim();
        if (monthlyPriceRub.trim()) {
          const p = Number(monthlyPriceRub);
          if (!Number.isFinite(p) || p < 0) {
            throw new Error('Цена должна быть неотрицательным числом');
          }
          body.monthlyPriceRub = Math.floor(p);
        }
        if (sortOrder.trim()) {
          const s = Number(sortOrder);
          if (Number.isFinite(s) && s >= 0) {
            body.sortOrder = Math.floor(s);
          }
        }
        await adminPlansApi.create(body);
        toast.success(`Тариф ${id} создан`);
      } else {
        const body: UpdatePlanRequest = {
          displayName: displayName.trim(),
          features: featuresMap,
          quotas: quotasMap,
          description: description.trim() || null,
          isActive,
        };
        if (monthlyPriceRub.trim()) {
          const p = Number(monthlyPriceRub);
          if (!Number.isFinite(p) || p < 0) {
            throw new Error('Цена должна быть неотрицательным числом');
          }
          body.monthlyPriceRub = Math.floor(p);
        } else {
          body.monthlyPriceRub = null;
        }
        if (sortOrder.trim()) {
          const s = Number(sortOrder);
          if (Number.isFinite(s) && s >= 0) {
            body.sortOrder = Math.floor(s);
          }
        }
        await adminPlansApi.update(plan!.id, body);
        toast.success(`Тариф ${plan!.id} обновлён`);
      }

      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось сохранить';
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
            {isEdit ? `Редактировать тариф ${plan!.id}` : 'Создать тариф'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Поля Plan.features / Plan.quotas — свободный JSON-словарь. Org с этим тарифом подхватят новые значения при следующей resolve-операции.'
              : 'Id плана нельзя поменять после создания. Используйте префикс tier_* (конвенция).'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ─── Базовое ─── */}
          <section className="space-y-3 rounded-md border border-border-subtle p-4">
            <h3 className="text-sm font-medium">Базовое</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="plan-id">
                  Id <span className="text-danger">*</span>
                </Label>
                <Input
                  id="plan-id"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="tier_pro"
                  disabled={isEdit}
                />
                {!isEdit && !idValid && id.length > 0 && (
                  <p className="text-[11px] text-danger">
                    Только латиница, цифры и подчёркивания. От 2 до 64 символов.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-name">
                  Название <span className="text-danger">*</span>
                </Label>
                <Input
                  id="plan-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Pro"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-price">Цена, ₽/мес</Label>
                <Input
                  id="plan-price"
                  type="number"
                  min={0}
                  step={1}
                  value={monthlyPriceRub}
                  onChange={(e) => setMonthlyPriceRub(e.target.value)}
                  placeholder="0 — бесплатно"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-order">Порядок сортировки</Label>
                <Input
                  id="plan-order"
                  type="number"
                  min={0}
                  step={1}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              {isEdit && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Switch
                    checked={isActive}
                    onCheckedChange={(v) => setIsActive(v)}
                  />
                  <Label className="!mb-0">Активен</Label>
                  <p className="text-[11px] text-fg-tertiary">
                    Если выключено — тариф не предлагается новым Org, но
                    существующие продолжают пользоваться.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-desc">Описание</Label>
              <Textarea
                id="plan-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Кому подходит этот тариф"
              />
            </div>
          </section>

          {/* ─── Фичи ─── */}
          <KvSection
            title="Фичи"
            description="Произвольные ключи → булево. Включённая фича доступна Org с этим тарифом."
            valueType="boolean"
            rows={features}
            onChange={setFeatures}
            placeholderKey="ai_chat"
          />

          {/* ─── Лимиты ─── */}
          <KvSection
            title="Лимиты"
            description="Произвольные ключи → число. Пустое поле = удалить лимит из тарифа."
            valueType="number"
            rows={quotas}
            onChange={setQuotas}
            placeholderKey="max_meetings_per_day"
          />

          {error && (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !canSave}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            {saving ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────── KV-секция ─────────────────────────────────────

type KvSectionProps =
  | {
      title: string;
      description: string;
      valueType: 'boolean';
      rows: FeatureRow[];
      onChange: (next: FeatureRow[]) => void;
      placeholderKey: string;
    }
  | {
      title: string;
      description: string;
      valueType: 'number';
      rows: QuotaRow[];
      onChange: (next: QuotaRow[]) => void;
      placeholderKey: string;
    };

function KvSection(props: KvSectionProps) {
  const addRow = () => {
    if (props.valueType === 'boolean') {
      const next: FeatureRow = { id: cryptoId(), key: '', value: false };
      props.onChange([...props.rows, next]);
    } else {
      const next: QuotaRow = { id: cryptoId(), key: '', value: '' };
      props.onChange([...props.rows, next]);
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-border-subtle p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{props.title}</h3>
          <p className="text-xs text-fg-tertiary">{props.description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus size={14} /> Добавить
        </Button>
      </div>
      {props.rows.length === 0 ? (
        <p className="text-xs text-fg-tertiary">Пока пусто.</p>
      ) : (
        <div className="space-y-2">
          {props.valueType === 'boolean'
            ? props.rows.map((row, idx) => (
                <FeatureRowEditor
                  key={row.id}
                  row={row}
                  onChange={(next) => {
                    const copy = [...props.rows];
                    copy[idx] = next;
                    props.onChange(copy);
                  }}
                  onRemove={() => {
                    const copy = props.rows.filter((_, i) => i !== idx);
                    props.onChange(copy);
                  }}
                  placeholderKey={props.placeholderKey}
                />
              ))
            : props.rows.map((row, idx) => (
                <QuotaRowEditor
                  key={row.id}
                  row={row}
                  onChange={(next) => {
                    const copy = [...props.rows];
                    copy[idx] = next;
                    props.onChange(copy);
                  }}
                  onRemove={() => {
                    const copy = props.rows.filter((_, i) => i !== idx);
                    props.onChange(copy);
                  }}
                  placeholderKey={props.placeholderKey}
                />
              ))}
        </div>
      )}
    </section>
  );
}

function FeatureRowEditor({
  row,
  onChange,
  onRemove,
  placeholderKey,
}: {
  row: FeatureRow;
  onChange: (next: FeatureRow) => void;
  onRemove: () => void;
  placeholderKey: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        value={row.key}
        onChange={(e) => onChange({ ...row, key: e.target.value })}
        placeholder={placeholderKey}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-2 rounded-md border border-border-subtle px-3 py-1.5">
        <Switch
          checked={row.value}
          onCheckedChange={(v) => onChange({ ...row, value: v })}
        />
        <span className="text-xs text-fg-secondary">
          {row.value ? 'включено' : 'выключено'}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-danger hover:bg-danger/10"
        title="Удалить"
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

function QuotaRowEditor({
  row,
  onChange,
  onRemove,
  placeholderKey,
}: {
  row: QuotaRow;
  onChange: (next: QuotaRow) => void;
  onRemove: () => void;
  placeholderKey: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        value={row.key}
        onChange={(e) => onChange({ ...row, key: e.target.value })}
        placeholder={placeholderKey}
        className="font-mono text-xs"
      />
      <Input
        type="number"
        min={0}
        step={1}
        value={row.value}
        onChange={(e) => onChange({ ...row, value: e.target.value })}
        placeholder="число"
        className="max-w-[200px] tabular-nums"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-danger hover:bg-danger/10"
        title="Удалить"
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

// ─────────────────────────────── helpers ────────────────────────────────────

function featuresMapToRows(map: PlanFeaturesMap): FeatureRow[] {
  return Object.entries(map).map(([key, value]) => ({
    id: cryptoId(),
    key,
    value: typeof value === 'boolean' ? value : Boolean(value),
  }));
}

function quotasMapToRows(map: PlanQuotasMap): QuotaRow[] {
  return Object.entries(map).map(([key, value]) => ({
    id: cryptoId(),
    key,
    value: typeof value === 'number' ? String(value) : String(value ?? ''),
  }));
}

function cryptoId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    'crypto' in globalThis &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `row_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
