'use client';

/**
 * Диалог принудительной смены статуса подписки (`force-status`).
 *
 * Это бэкдор для саппорта в исключительных случаях — обход FSM подписки.
 * Может оставить подписку в неконсистентном состоянии (например, ACTIVE
 * без оплаченного инвойса). Поэтому submit требует ДВОЙНОГО подтверждения:
 *   1. reason (≥3 символа);
 *   2. чекбокс «Я понимаю, что обхожу FSM».
 *
 * Действие пишется в `AdminAuditLog` бэкендом.
 *
 * См. plans/tz/2026-05-29-admin-subscription-ui-v2.md (Фаза 3).
 */

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { billingApi } from '@/api/billing.api';
import type { SubscriptionStatus } from '@/domain/billing';
import { subscriptionStatusLabel } from '@/domain/billing';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

const STATUSES: SubscriptionStatus[] = [
  'DEMO',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELED',
  'EXPIRED',
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  currentStatus: SubscriptionStatus;
  onSuccess: () => void;
};

export function ForceStatusDialog({
  open,
  onOpenChange,
  tenantId,
  currentStatus,
  onSuccess,
}: Props) {
  const [newStatus, setNewStatus] = useState<SubscriptionStatus>(currentStatus);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reasonValid = reason.trim().length >= 3;
  const statusChanged = newStatus !== currentStatus;
  const canSubmit =
    reasonValid && confirmed && statusChanged && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await billingApi.adminForceStatus(tenantId, {
        newStatus,
        reason: reason.trim(),
      });
      toast.success(
        `Статус подписки изменён на ${subscriptionStatusLabel(newStatus)}`,
      );
      setReason('');
      setConfirmed(false);
      onSuccess();
    } catch (e2) {
      toast.error(
        e2 instanceof ApiError ? e2.message : 'Не удалось изменить статус',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Принудительно сменить статус подписки</DialogTitle>
            <DialogDescription>
              Это обход стандартной FSM. Использовать только в исключительных
              ситуациях (восстановление после сбоя, ручная отмена, и т.п.).
              Действие будет записано в журнал super_admin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Текущий статус</Label>
            <p className="text-sm font-medium">
              {subscriptionStatusLabel(currentStatus)}{' '}
              <span className="font-mono text-xs text-muted-foreground">
                ({currentStatus})
              </span>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="forceStatus-new">
              Новый статус <span className="text-danger">*</span>
            </Label>
            <Select
              value={newStatus}
              onValueChange={(v) => setNewStatus(v as SubscriptionStatus)}
            >
              <SelectTrigger
                id="forceStatus-new"
                aria-label="Новый статус подписки"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {subscriptionStatusLabel(s)} ({s})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="forceStatus-reason">
              Причина (≥3 символа) <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="forceStatus-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: восстановление после некорректной отмены тикет #7890"
              rows={2}
              minLength={3}
              maxLength={500}
              required
            />
            <div className="text-[10px] text-fg-tertiary">
              {reason.length}/500
            </div>
          </div>

          <label
            htmlFor="forceStatus-confirm"
            className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm cursor-pointer"
          >
            <Checkbox
              id="forceStatus-confirm"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              className="mt-0.5"
            />
            <span className="flex-1 leading-relaxed">
              <AlertTriangle
                size={14}
                className="inline mr-1 text-warning"
              />
              Я понимаю, что обхожу FSM, и это может оставить подписку в
              неконсистентном состоянии.
            </span>
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!canSubmit}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Сменить статус
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
