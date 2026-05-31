'use client';

/**
 * Диалог изменения числа доп. мест (`adjust-seats`).
 *
 * Поля:
 *   - newSeatsExtra (number ≥0) — целевое количество доп. мест;
 *   - reason (string ≥3) — обоснование для audit-log.
 *
 * Pro-rata preview: показывается опционально, если родитель передал
 * `daysLeftInMonthlyPeriod` или `monthsLeftInYearlyPeriod`. На MVP бэкенд
 * сам считает доплату (см. ManualBillingService.adjustSeats); preview
 * информирует саппорта какое окно остатка периода учитывается.
 *
 * См. plans/tz/2026-05-29-admin-subscription-ui-v2.md (Фаза 3).
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { billingApi } from '@/api/billing.api';
import type { BillingPeriod } from '@/domain/billing';
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
import { Textarea } from '@/ui/shadcn/textarea';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  currentSeatsExtra: number;
  billingPeriod: BillingPeriod | null;
  /** Опциональный pro-rata-намёк: дней осталось в текущем месячном периоде. */
  daysLeftInMonthlyPeriod?: number;
  /** Опциональный pro-rata-намёк: месяцев осталось в годовом периоде. */
  monthsLeftInYearlyPeriod?: number;
  onSuccess: () => void;
};

export function AdjustSeatsDialog({
  open,
  onOpenChange,
  tenantId,
  currentSeatsExtra,
  billingPeriod,
  daysLeftInMonthlyPeriod,
  monthsLeftInYearlyPeriod,
  onSuccess,
}: Props) {
  const [newSeatsExtra, setNewSeatsExtra] = useState<number>(currentSeatsExtra);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const seatsValid = Number.isFinite(newSeatsExtra) && newSeatsExtra >= 0;
  const reasonValid = reason.trim().length >= 3;
  const noChange = newSeatsExtra === currentSeatsExtra;
  const canSubmit = seatsValid && reasonValid && !noChange && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body: Parameters<typeof billingApi.adminAdjustSeats>[1] = {
        newSeatsExtra,
        reason: reason.trim(),
      };
      if (
        billingPeriod === 'monthly' &&
        typeof daysLeftInMonthlyPeriod === 'number'
      ) {
        body.daysLeftInMonthlyPeriod = daysLeftInMonthlyPeriod;
      }
      if (
        billingPeriod === 'yearly' &&
        typeof monthsLeftInYearlyPeriod === 'number'
      ) {
        body.monthsLeftInYearlyPeriod = monthsLeftInYearlyPeriod;
      }
      await billingApi.adminAdjustSeats(tenantId, body);
      toast.success('Количество мест изменено');
      setReason('');
      onSuccess();
    } catch (e2) {
      toast.error(
        e2 instanceof ApiError ? e2.message : 'Не удалось изменить места',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Pro-rata preview: показываем какой остаток периода учтёт бэкенд при
  // доплате. Сама формула pro-rata считается на бэке (manual-billing).
  const proRataHint = (() => {
    if (newSeatsExtra <= currentSeatsExtra) return null;
    if (
      billingPeriod === 'monthly' &&
      typeof daysLeftInMonthlyPeriod === 'number'
    ) {
      return `Будет доплата pro-rata за ${daysLeftInMonthlyPeriod} оставшихся дней в текущем месячном периоде.`;
    }
    if (
      billingPeriod === 'yearly' &&
      typeof monthsLeftInYearlyPeriod === 'number'
    ) {
      return `Будет доплата pro-rata за ${monthsLeftInYearlyPeriod} оставшихся месяцев в годовом периоде.`;
    }
    return 'Будет доплата pro-rata за оставшийся период.';
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Изменить количество мест</DialogTitle>
            <DialogDescription>
              Текущее значение доп. мест:{' '}
              <strong>{currentSeatsExtra}</strong>. Базовое место (хост) не
              изменяется. При увеличении бэкенд автоматически создаст
              pro-rata-инвойс на доплату.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="adjustSeats-new">
              Новое количество доп. мест{' '}
              <span className="text-danger">*</span>
            </Label>
            <Input
              id="adjustSeats-new"
              type="number"
              min={0}
              max={10000}
              step={1}
              value={newSeatsExtra}
              onChange={(e) => setNewSeatsExtra(Number(e.target.value))}
              required
              autoFocus
            />
            {!seatsValid && (
              <p className="text-[11px] text-danger">
                Введите целое число ≥ 0.
              </p>
            )}
            {proRataHint && (
              <p className="text-[11px] text-fg-secondary">{proRataHint}</p>
            )}
            {newSeatsExtra < currentSeatsExtra && (
              <p className="text-[11px] text-fg-tertiary">
                Уменьшение — без возврата средств за уже оплаченный период.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjustSeats-reason">
              Причина (≥3 символа) <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="adjustSeats-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: клиент вырос с 30 до 50 человек, тикет #4567"
              rows={2}
              minLength={3}
              maxLength={500}
              required
            />
            <div className="text-[10px] text-fg-tertiary">
              {reason.length}/500
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Изменить места
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
