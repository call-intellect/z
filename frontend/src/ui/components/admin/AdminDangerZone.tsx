'use client';

import {
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Textarea } from '@/ui/shadcn/textarea';
import { cn } from '@/ui/shadcn/lib/utils';

export type DangerSeverity = 'low' | 'medium' | 'high' | 'destructive';

/**
 * AdminDangerZone — обёртка для блока «Опасная зона».
 *
 * Использование:
 *   <AdminDangerZone>
 *     <DangerAction
 *       label="Удалить организацию"
 *       title="Удалить организацию?"
 *       description="Все данные тенанта будут безвозвратно удалены."
 *       severity="destructive"
 *       onConfirm={async (reason) => { ... }}
 *     />
 *   </AdminDangerZone>
 */
export function AdminDangerZone({
  title = 'Опасная зона',
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-danger/40 bg-danger/5 p-4',
        className,
      )}
    >
      <header className="mb-3 flex items-start gap-2">
        <AlertTriangle
          size={16}
          className="mt-0.5 shrink-0 text-danger"
          aria-hidden
        />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-danger">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-fg-secondary">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * Severity-таблица:
 *  - low / medium: подтверждение без обязательной причины (но `requiresReason`
 *    можно выставить вручную).
 *  - high / destructive: причина обязательна (textarea, минимум 10 символов).
 *
 * Кнопка-триггер рендерится через `variant="destructive"` для high/destructive,
 * иначе — `outline`. Можно переопределить через `triggerVariant`.
 */
type DangerActionProps = {
  /** Текст основной кнопки-триггера. */
  label: string;
  /** Заголовок диалога подтверждения. */
  title: string;
  /** Описание (что произойдёт). */
  description?: ReactNode;
  /** Уровень опасности — влияет на оформление и требование reason. */
  severity?: DangerSeverity;
  /**
   * Принудительно требовать причину. По умолчанию — true для high/destructive,
   * false для low/medium.
   */
  requiresReason?: boolean;
  /** Текст кнопки подтверждения. По умолчанию «Подтвердить». */
  confirmLabel?: string;
  /** Текст кнопки отмены. По умолчанию «Отмена». */
  cancelLabel?: string;
  /** Колбэк выполнения — может получить reason (если запрашивалась). */
  onConfirm: (reason?: string) => Promise<void> | void;
  /** Заблокировать кнопку (например, во время загрузки данных). */
  disabled?: boolean;
  /** Variant кнопки-триггера. По умолчанию — destructive для high/destructive. */
  triggerVariant?: 'destructive' | 'outline' | 'secondary' | 'ghost';
};

const MIN_REASON_LENGTH = 10;

export function DangerAction({
  label,
  title,
  description,
  severity = 'medium',
  requiresReason,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  onConfirm,
  disabled,
  triggerVariant,
}: DangerActionProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReason =
    requiresReason ?? (severity === 'high' || severity === 'destructive');

  const computedVariant =
    triggerVariant ??
    (severity === 'destructive' || severity === 'high'
      ? 'destructive'
      : 'outline');

  const reset = useCallback(() => {
    setReason('');
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (pending) return;
      setOpen(next);
      if (!next) reset();
    },
    [pending, reset],
  );

  const handleConfirm = useCallback(async () => {
    if (pending) return;
    setError(null);
    const trimmed = reason.trim();
    if (needsReason && trimmed.length < MIN_REASON_LENGTH) {
      setError(
        `Опишите причину минимум в ${MIN_REASON_LENGTH} символов — это требование журнала.`,
      );
      return;
    }
    try {
      setPending(true);
      await onConfirm(needsReason ? trimmed : undefined);
      setOpen(false);
      reset();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось выполнить — попробуйте ещё раз.',
      );
    } finally {
      setPending(false);
    }
  }, [pending, reason, needsReason, onConfirm, reset]);

  return (
    <>
      <Button
        type="button"
        variant={computedVariant}
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <AlertTriangle size={16} aria-hidden />
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {needsReason ? (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="danger-reason"
                className="text-xs font-medium text-fg-secondary"
              >
                Причина изменения
                <span className="ml-1 text-danger">*</span>
              </label>
              <Textarea
                id="danger-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={`Минимум ${MIN_REASON_LENGTH} символов. Будет сохранено в журнале super_admin.`}
                rows={3}
                disabled={pending}
              />
              <p className="text-[11px] text-fg-tertiary">
                {reason.trim().length}/{MIN_REASON_LENGTH}
              </p>
            </div>
          ) : null}
          {error ? (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              type="button"
              disabled={pending}
              onClick={() => void handleConfirm()}
            >
              {pending ? 'Выполняю…' : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
