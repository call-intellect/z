"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { billingApi } from "@/api/billing.api";
import type { InvoiceDomain } from "@/domain/billing";
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
import { Textarea } from "@/ui/shadcn/textarea";

type Props = {
  invoice: InvoiceDomain;
  onChanged: () => void;
};

export function InvoiceRowActions({ invoice, onChanged }: Props) {
  const [openMarkPaid, setOpenMarkPaid] = useState(false);
  const [openVoid, setOpenVoid] = useState(false);

  const canMarkPaid = invoice.status === "issued";
  const canVoid = invoice.status === "draft" || invoice.status === "issued";

  if (!canMarkPaid && !canVoid) return null;

  return (
    <div className="flex items-center justify-end gap-1">
      {canMarkPaid && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpenMarkPaid(true)}
          aria-label="Пометить как оплачен"
          title="Пометить как оплачен"
        >
          <CheckCircle2 size={14} className="text-green-700" />
        </Button>
      )}
      {canVoid && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpenVoid(true)}
          aria-label="Аннулировать счёт"
          title="Аннулировать счёт"
        >
          <XCircle size={14} className="text-red-700" />
        </Button>
      )}

      {canMarkPaid && (
        <MarkPaidDialog
          open={openMarkPaid}
          onOpenChange={setOpenMarkPaid}
          invoice={invoice}
          onSuccess={() => {
            setOpenMarkPaid(false);
            onChanged();
          }}
        />
      )}
      {canVoid && (
        <VoidDialog
          open={openVoid}
          onOpenChange={setOpenVoid}
          invoice={invoice}
          onSuccess={() => {
            setOpenVoid(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function MarkPaidDialog({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: InvoiceDomain;
  onSuccess: () => void;
}) {
  const [externalRef, setExternalRef] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reasonValid = reason.trim().length >= 3;
  const externalRefValid = externalRef.trim().length > 0;
  const canSubmit = reasonValid && externalRefValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await billingApi.adminMarkInvoicePaid(invoice.id, {
        externalRef: externalRef.trim(),
        reason: reason.trim(),
      });
      toast.success(`Счёт ${invoice.invoiceNumber} помечен как оплачен`);
      setExternalRef("");
      setReason("");
      onSuccess();
    } catch (e2) {
      toast.error(
        e2 instanceof ApiError ? e2.message : "Не удалось пометить счёт",
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
            <DialogTitle>Пометить счёт как оплачен</DialogTitle>
            <DialogDescription>
              Счёт{" "}
              <code className="rounded bg-bg-overlay px-1">
                {invoice.invoiceNumber}
              </code>
              . Операция идемпотентна (повторный вызов не создаст дубля
              реф-выплаты).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="markPaid-externalRef">
              Номер платёжки / внешний референс{" "}
              <span className="text-danger">*</span>
            </Label>
            <Input
              id="markPaid-externalRef"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="Например: payment_2026_05_29_001"
              required
              autoFocus
            />
            <p className="text-[11px] text-fg-tertiary">
              Сохраняется в audit-log для последующей сверки с банком.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="markPaid-reason">
              Причина (≥3 символа) <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="markPaid-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: оплата по тикету #1234"
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
              Пометить оплаченным
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: InvoiceDomain;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reasonValid = reason.trim().length >= 3;
  const canSubmit = reasonValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await billingApi.adminVoidInvoice(invoice.id, {
        reason: reason.trim(),
      });
      toast.success(`Счёт ${invoice.invoiceNumber} аннулирован`);
      setReason("");
      onSuccess();
    } catch (e2) {
      toast.error(
        e2 instanceof ApiError ? e2.message : "Не удалось аннулировать",
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
            <DialogTitle>Аннулировать счёт?</DialogTitle>
            <DialogDescription>
              Счёт{" "}
              <code className="rounded bg-bg-overlay px-1">
                {invoice.invoiceNumber}
              </code>{" "}
              перейдёт в статус «Отменён» и будет исключён из метрик выручки.
              Для оплаченных счетов операция запрещена бэкендом.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="void-reason">
              Причина (≥3 символа) <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: ошибочно выпущенный счёт"
              rows={2}
              minLength={3}
              maxLength={500}
              required
              autoFocus
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
            <Button type="submit" variant="destructive" disabled={!canSubmit}>
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Аннулировать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
