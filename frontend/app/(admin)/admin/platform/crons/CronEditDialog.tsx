"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { adminCronsApi } from "@/api/admin-crons.api";
import { ApiError } from "@/api/api-error";
import {
  humanizeCronExpression,
  type CronScheduleDomain,
} from "@/domain/admin-cron";
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
import { Switch } from "@/ui/shadcn/switch";
import { Textarea } from "@/ui/shadcn/textarea";

const MIN_REASON_LENGTH = 10;

type Props = {
  cron: CronScheduleDomain | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

export function CronEditDialog({ cron, open, onOpenChange, onSaved }: Props) {
  const [expression, setExpression] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cron) return;
    setExpression(cron.expression);
    setEnabled(cron.enabled);
    setReason("");
    setError(null);
  }, [cron]);

  const handleClose = (next: boolean) => {
    if (saving) return;
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!cron) return;
    setError(null);
    const trimmedReason = reason.trim();
    if (trimmedReason.length < MIN_REASON_LENGTH) {
      setError(
        `Опишите причину минимум в ${MIN_REASON_LENGTH} символов — это требование журнала super_admin.`,
      );
      return;
    }
    if (!expression.trim()) {
      setError("Расписание не может быть пустым.");
      return;
    }
    setSaving(true);
    try {
      await adminCronsApi.update(cron.name, {
        expression: expression.trim(),
        enabled,
        reason: trimmedReason,
      });
      toast.success(`Расписание для «${cron.name}» обновлено`);
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

  if (!cron) return null;

  const preview = humanizeCronExpression(expression);
  const previewDiffers = preview && preview !== expression;
  const isDirty =
    expression.trim() !== cron.expression || enabled !== cron.enabled;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Изменить расписание: {cron.name}</DialogTitle>
          <DialogDescription>
            Сохранение синхронизируется во всех процессах через Redis pub/sub.
            Дефолтное расписание из кода —{" "}
            <code>{cron.defaultExpression || "—"}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label htmlFor="cron-expr">Расписание (cron-выражение)</Label>
            <Input
              id="cron-expr"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="*/5 * * * *"
              className="font-mono text-sm"
              disabled={saving}
            />
            {previewDiffers ? (
              <p className="text-[11px] text-fg-tertiary">
                Превью: <span className="text-fg-secondary">{preview}</span>
              </p>
            ) : (
              <p className="text-[11px] text-fg-tertiary">
                Формат: «минуты часы день_месяца месяц день_недели».
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2">
            <Switch
              checked={enabled}
              onCheckedChange={(v) => setEnabled(v)}
              disabled={saving}
            />
            <div className="min-w-0 text-xs">
              <p className="font-medium text-fg-primary">
                {enabled ? "Включён" : "Выключен"}
              </p>
              <p className="text-fg-tertiary">
                Выключенный крон не запускается по расписанию, но остаётся
                доступным для ручного запуска.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cron-reason">
              Причина изменения <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="cron-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Минимум ${MIN_REASON_LENGTH} символов. Будет сохранено в журнале super_admin.`}
              rows={3}
              disabled={saving}
            />
            <p className="text-[11px] text-fg-tertiary">
              {reason.trim().length}/{MIN_REASON_LENGTH}
            </p>
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

        <DialogFooter className="sm:gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={saving}
            onClick={() => handleClose(false)}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={saving || !isDirty}
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
