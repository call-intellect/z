'use client';

/**
 * Модалка редактирования цепочки моделей для одного taskType.
 *
 * Три блока: Primary / Secondary / Tertiary. Каждый блок — Select по
 * провайдеру + Input по модели (с подсказкой через `<datalist>`).
 *
 * При сохранении формируется массив `providers`, в порядке primary → secondary
 * → tertiary, без пустых tier'ов. PUT идёт на `/admin/llm-routes/:taskType`.
 * После — `onSaved()` вызывает `mutate()` в родителе (оптимистичная замена
 * через SWR-cache: новые данные подтянутся из ответа).
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  adminLlmRoutesApi,
  LLM_PROVIDERS,
  type LlmProvider,
  type LlmRouteProvider,
} from '@/api/admin-llm-routes.api';
import {
  KNOWN_MODELS,
  providerLabel,
  type LlmRouteUi,
} from '@/domain/admin-llm-route';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

type TierForm = {
  enabled: boolean;
  provider: LlmProvider;
  model: string;
};

function defaultTier(
  source: LlmRouteUi['primary'] | undefined,
  fallback: LlmProvider,
): TierForm {
  if (!source) {
    return { enabled: false, provider: fallback, model: '' };
  }
  const known = LLM_PROVIDERS.includes(source.providerName as LlmProvider)
    ? (source.providerName as LlmProvider)
    : fallback;
  return {
    enabled: true,
    provider: known,
    model: source.model === '—' ? '' : source.model,
  };
}

export function EditRouteDialog({
  route,
  onClose,
  onSaved,
}: {
  route: LlmRouteUi;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [primary, setPrimary] = useState<TierForm>(() =>
    defaultTier(route.primary, 'deepseek'),
  );
  const [secondary, setSecondary] = useState<TierForm>(() =>
    defaultTier(route.secondary, 'openai-via-proxy'),
  );
  const [tertiary, setTertiary] = useState<TierForm>(() =>
    defaultTier(route.tertiary, 'ollama'),
  );
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Если хотя бы один tier включён и primary не пуст — считаем что primary он же.
  // Primary тоже может быть отключён (роут вырубается целиком через isActive=false).
  const tiers = useMemo<TierForm[]>(
    () => [primary, secondary, tertiary],
    [primary, secondary, tertiary],
  );

  const enabledTiers = tiers.filter((t) => t.enabled);
  const deepseekProWarning =
    enabledTiers.some(
      (t) =>
        t.provider === 'deepseek' &&
        t.model.toLowerCase().includes('pro'),
    );

  const handleSave = async () => {
    if (enabledTiers.length === 0) {
      toast.error('Нужен хотя бы один tier');
      return;
    }
    const providers: LlmRouteProvider[] = enabledTiers.map((t) => ({
      provider: t.provider,
      ...(t.model.trim() ? { model: t.model.trim() } : {}),
    }));
    setSubmitting(true);
    try {
      await adminLlmRoutesApi.upsert(route.taskType, {
        providers,
        isActive,
      });
      toast.success('Роут сохранён');
      await onSaved();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось сохранить роут',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o && !submitting ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Изменить роут:{' '}
            <code className="font-mono text-sm text-fg-secondary">
              {route.taskType}
            </code>
          </DialogTitle>
          <DialogDescription>
            Настройте провайдеров для primary, secondary и tertiary fallback.
            После сохранения seed-скрипты не будут перезатирать эту настройку.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <TierBlock
            title="Primary (основной)"
            description="Используется первым. Если упал — пробуем secondary."
            value={primary}
            onChange={setPrimary}
          />
          <TierBlock
            title="Secondary (запасной)"
            description="Включается, если primary недоступен."
            value={secondary}
            onChange={setSecondary}
          />
          <TierBlock
            title="Tertiary (локальный fallback)"
            description="Последний рубеж — обычно локальная Ollama."
            value={tertiary}
            onChange={setTertiary}
          />

          <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-subtle p-3">
            <Switch
              checked={isActive}
              onCheckedChange={(v) => setIsActive(v)}
            />
            <div className="text-sm">
              <div className="font-medium text-fg-primary">Роут активен</div>
              <div className="text-xs text-fg-secondary">
                Если выключено, LLM-Router не будет использовать эту цепочку.
              </div>
            </div>
          </div>

          <div className="rounded-md border border-chip-warning-bg bg-chip-warning-bg/30 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-chip-warning-fg"
              />
              <div className="text-fg-secondary">
                После сохранения роут получит флаг{' '}
                <code className="font-mono">editedByAdmin = true</code>. Дальнейшие
                seed-скрипты на проде <strong>не перезатрут</strong> эту запись.
              </div>
            </div>
          </div>

          {deepseekProWarning && (
            <div className="rounded-md border border-chip-warning-bg bg-chip-warning-bg/60 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-chip-warning-fg"
                />
                <div className="text-chip-warning-fg">
                  <strong>Внимание для DeepSeek-Pro:</strong> убедитесь, что в
                  бэкенде включена автоконвертация{' '}
                  <code className="font-mono">json_schema → tools</code> (ТЗ{' '}
                  <code className="font-mono">
                    deepseek-pro-output-format-fix
                  </code>
                  ), иначе агенты, ожидающие strict JSON Schema, начнут падать.
                </div>
              </div>
            </div>
          )}
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
            onClick={() => void handleSave()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" /> Сохраняем…
              </>
            ) : (
              'Сохранить'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TierBlock({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: TierForm;
  onChange: (next: TierForm) => void;
}) {
  const datalistId = `models-${value.provider}`;
  const knownModels = KNOWN_MODELS[value.provider] ?? [];

  return (
    <div className="rounded-md border border-border-subtle p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-fg-primary">{title}</div>
          <div className="text-xs text-fg-secondary">{description}</div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          />
          {value.enabled ? 'Включён' : 'Отключён'}
        </label>
      </div>

      {value.enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Провайдер</Label>
            <Select
              value={value.provider}
              onValueChange={(v) =>
                onChange({ ...value, provider: v as LlmProvider, model: '' })
              }
            >
              <SelectTrigger className="h-9 bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LLM_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Модель</Label>
            <Input
              value={value.model}
              list={datalistId}
              placeholder="Например: deepseek-v4-pro"
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
            <datalist id={datalistId}>
              {knownModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="mt-1 text-[11px] text-fg-tertiary">
              Если оставить пустым — провайдер использует свою дефолтную модель.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
