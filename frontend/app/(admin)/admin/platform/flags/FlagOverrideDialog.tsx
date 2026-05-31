'use client';

/**
 * Диалог быстрого добавления / изменения одного Org-override для FeatureFlag.
 *
 * Используется как точечная альтернатива большому `FlagEditDialog` — когда
 * оператору надо «включить флаг X только для Org Y». Сохраняет остальные
 * поля флага неизменными.
 *
 * Сейчас не используется в основном FeatureFlagsClient (там общий edit-flow),
 * но оставлен для будущих deep-link сценариев (например, из карточки Org).
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { adminFeatureFlagsApi } from '@/api/admin-feature-flags.api';
import { adminOrgsApi } from '@/api/admin-orgs.api';
import { ApiError } from '@/api/api-error';
import { type FeatureFlagDomain } from '@/domain/admin-feature-flag';
import { adminOrgListFromApi } from '@/domain/admin-org';
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
import { Textarea } from '@/ui/shadcn/textarea';

import { useAdminQuery } from '../../useAdminQuery';

type Props = {
  /** Если задан — диалог в «edit override» для конкретного флага. */
  flag: FeatureFlagDomain | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

export function FlagOverrideDialog({
  flag,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [orgId, setOrgId] = useState('');
  const [value, setValue] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgsQuery = useAdminQuery(
    open ? 'admin-flag-override-orgs' : '',
    async () => {
      const res = await adminOrgsApi.list({ limit: 200 });
      return adminOrgListFromApi(res);
    },
    [open],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOrgId('');
    setValue(true);
    setReason('');
  }, [open]);

  const canSave = useMemo(
    () => flag !== null && orgId.trim().length > 0,
    [flag, orgId],
  );

  const handleSave = async () => {
    if (!flag) return;
    setError(null);
    setSaving(true);
    try {
      const nextOverrides: Record<string, boolean> = {
        ...(flag.orgOverrides ?? {}),
        [orgId.trim()]: value,
      };
      await adminFeatureFlagsApi.update(flag.key, {
        orgOverrides: nextOverrides,
        reason: reason.trim() || undefined,
      });
      toast.success(
        `Override для «${flag.key}» сохранён: ${orgId} → ${value ? 'вкл' : 'выкл'}`,
      );
      onSaved();
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

  if (!flag) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Override: <code className="font-mono">{flag.key}</code>
          </DialogTitle>
          <DialogDescription>
            Перекрывает глобальный default ({flag.defaultValue ? 'вкл' : 'выкл'})
            для выбранной Org. Остальные поля флага сохраняются.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor="override-org">Org</Label>
            {orgsQuery.data && orgsQuery.data.items.length > 0 ? (
              <Select
                value={orgId}
                onValueChange={(v) => setOrgId(v)}
                disabled={saving}
              >
                <SelectTrigger id="override-org">
                  <SelectValue placeholder="Выберите Org" />
                </SelectTrigger>
                <SelectContent>
                  {orgsQuery.data.items.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="font-mono text-xs">{o.id}</span>
                      <span className="ml-2 text-fg-tertiary">— {o.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="override-org"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="tenantId"
                className="font-mono text-xs"
                disabled={saving}
              />
            )}
          </div>

          <div className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2">
            <Switch
              checked={value}
              onCheckedChange={(v) => setValue(v)}
              disabled={saving}
            />
            <div className="min-w-0 text-xs">
              <p className="font-medium text-fg-primary">
                Значение: {value ? 'вкл' : 'выкл'}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="override-reason">Причина (опц.)</Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              disabled={saving}
              placeholder="Например: «бета-тестирование на Org acme»"
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
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
