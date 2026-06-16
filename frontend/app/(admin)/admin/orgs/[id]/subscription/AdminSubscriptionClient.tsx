"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Settings2,
  ShieldAlert,
  Sparkles,
  UsersRound,
} from "lucide-react";

import { ApiError } from "@/api/api-error";
import { billingApi } from "@/api/billing.api";
import type { AdminOrgBillingResponseApi } from "@/api/types/billing";
import {
  formatRubles,
  invoiceFromApi,
  invoiceStatusLabel,
  subscriptionFromApi,
  subscriptionStatusColor,
  subscriptionStatusLabel,
  type InvoiceDomain,
  type SubscriptionDomain,
} from "@/domain/billing";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Skeleton } from "@/ui/shadcn/skeleton";

import { AdjustSeatsDialog } from "./AdjustSeatsDialog";
import { ForceStatusDialog } from "./ForceStatusDialog";
import { InvoiceRowActions } from "./InvoiceRowActions";
import { SubscriptionEventsTimeline } from "./SubscriptionEventsTimeline";

export function AdminSubscriptionClient({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<AdminOrgBillingResponseApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await billingApi.adminGetOrgBilling(tenantId);
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const subscription = data?.subscription
    ? subscriptionFromApi(data.subscription)
    : null;
  const invoices = data?.recentInvoices.map(invoiceFromApi) ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      <CurrentSubscriptionCard
        tenantId={tenantId}
        subscription={subscription}
        onReload={() => void load()}
      />

      <ActivateForm tenantId={tenantId} onActivated={() => void load()} />

      <RecentInvoicesTable invoices={invoices} onReload={() => void load()} />

      <SubscriptionEventsTimeline tenantId={tenantId} />
    </div>
  );
}

function CurrentSubscriptionCard({
  tenantId,
  subscription,
  onReload,
}: {
  tenantId: string;
  subscription: SubscriptionDomain | null;
  onReload: () => void;
}) {
  const [openAdjust, setOpenAdjust] = useState(false);
  const [openForce, setOpenForce] = useState(false);

  if (!subscription) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Подписки нет — Org в DEMO-режиме.
        </p>
      </div>
    );
  }

  const colorClass = {
    green: "bg-green-100 text-green-900",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-900",
    slate: "bg-slate-100 text-slate-900",
  }[subscriptionStatusColor(subscription.status)];

  const now = new Date();
  const periodEnd = subscription.currentPeriodEnd;
  const periodStart = subscription.currentPeriodStart;
  let daysLeftInMonthlyPeriod: number | undefined;
  let monthsLeftInYearlyPeriod: number | undefined;
  if (periodEnd && periodStart && periodEnd > now) {
    if (subscription.billingPeriod === "monthly") {
      daysLeftInMonthlyPeriod = Math.max(
        0,
        Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000),
      );
    } else if (subscription.billingPeriod === "yearly") {
      monthsLeftInYearlyPeriod = Math.max(
        0,
        Math.floor(
          (periodEnd.getTime() - now.getTime()) / (30.44 * 86_400_000),
        ),
      );
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h2 className="text-lg font-medium">Текущая подписка</h2>
          <p className="text-sm text-muted-foreground">
            {subscription.paymentMode === "paid"
              ? "Платная (учитывается в выручке + реф-комиссия)"
              : subscription.paymentMode === "bonus"
                ? "Бонусная (не в выручке, реф не идёт)"
                : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {subscription.paymentMode === "bonus" && (
            <Badge className="bg-amber-100 text-amber-900 border border-amber-200">
              Бонус
            </Badge>
          )}
          <Badge className={colorClass}>
            {subscriptionStatusLabel(subscription.status)}
          </Badge>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Период" value={subscription.billingPeriod ?? "—"} />
        <Field
          label="Цена / месяц"
          value={formatRubles(subscription.monthlyPriceKopecks)}
        />
        <Field
          label="Места"
          value={`${subscription.seatsBase + 1} + ${subscription.seatsExtra}`}
        />
        <Field
          label="autoRenew"
          value={subscription.autoRenew ? "да" : "нет"}
        />
        <Field
          label="Текущий период"
          value={
            subscription.currentPeriodStart && subscription.currentPeriodEnd
              ? `${subscription.currentPeriodStart.toLocaleDateString("ru-RU")} — ${subscription.currentPeriodEnd.toLocaleDateString("ru-RU")}`
              : "—"
          }
        />
        <Field
          label="Всего оплачено"
          value={formatRubles(subscription.totalPaidKopecks)}
        />
      </dl>

      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" size="sm" onClick={() => setOpenAdjust(true)}>
          <UsersRound size={14} />
          Изменить места
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenForce(true)}
          className="text-danger hover:bg-danger/10"
          title="Принудительно сменить статус (обход FSM)"
        >
          <ShieldAlert size={14} />
          Принудительно сменить статус
        </Button>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-tertiary">
          <Settings2 size={11} />
          super_admin
        </span>
      </div>

      <AdjustSeatsDialog
        open={openAdjust}
        onOpenChange={setOpenAdjust}
        tenantId={tenantId}
        currentSeatsExtra={subscription.seatsExtra}
        billingPeriod={subscription.billingPeriod}
        daysLeftInMonthlyPeriod={daysLeftInMonthlyPeriod}
        monthsLeftInYearlyPeriod={monthsLeftInYearlyPeriod}
        onSuccess={() => {
          setOpenAdjust(false);
          onReload();
        }}
      />
      <ForceStatusDialog
        open={openForce}
        onOpenChange={setOpenForce}
        tenantId={tenantId}
        currentStatus={subscription.status}
        onSuccess={() => {
          setOpenForce(false);
          onReload();
        }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium mt-0.5">{value}</dd>
    </div>
  );
}

function ActivateForm({
  tenantId,
  onActivated,
}: {
  tenantId: string;
  onActivated: () => void;
}) {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">(
    "monthly",
  );
  const [seatsExtra, setSeatsExtra] = useState(0);
  const [paymentMode, setPaymentMode] = useState<"paid" | "bonus">("paid");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setErr("reason обязателен (≥3 символа)");
      return;
    }
    setSubmitting(true);
    setErr(null);
    setSuccess(null);
    try {
      const result = await billingApi.adminActivate(tenantId, {
        billingPeriod,
        seatsExtra,
        startedAt: new Date().toISOString(),
        paymentMode,
        reason: reason.trim(),
      });
      setSuccess(
        `Активировано. Subscription ${result.subscriptionId}, Invoice ${result.invoiceId}, +${result.grantedMeetings} встреч.`,
      );
      setReason("");
      onActivated();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-6 space-y-4"
    >
      <div>
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Активировать подписку
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ручная активация в режиме paid (в выручке + реф) или bonus.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Период</label>
          <select
            value={billingPeriod}
            onChange={(e) =>
              setBillingPeriod(e.target.value as "monthly" | "yearly")
            }
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="monthly">Месячная (60 000 ₽)</option>
            <option value="yearly">Годовая (576 000 ₽ со скидкой 20%)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Доп. мест</label>
          <Input
            type="number"
            min="0"
            max="10000"
            value={seatsExtra}
            onChange={(e) => setSeatsExtra(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Режим</label>
        <select
          value={paymentMode}
          onChange={(e) => setPaymentMode(e.target.value as "paid" | "bonus")}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="paid">
            paid — в выручке, идёт реф-комиссия 20 000 ₽
          </option>
          <option value="bonus">bonus — НЕ в выручке, реф НЕ идёт</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Reason (обязательно, ≥3)</label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например: оплачено по счёту №123 от 2026-05-27"
          required
          minLength={3}
        />
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {err}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <CheckCircle2 className="w-4 h-4 inline mr-1" />
          {success}
        </div>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        Активировать
      </Button>
    </form>
  );
}

function RecentInvoicesTable({
  invoices,
  onReload,
}: {
  invoices: InvoiceDomain[];
  onReload: () => void;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium">Последние счета</h2>
        <p className="text-sm text-muted-foreground mt-1">Счетов пока нет.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-medium">Последние счета (10)</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-6 py-3 font-medium">Номер</th>
            <th className="text-left px-6 py-3 font-medium">Сумма</th>
            <th className="text-left px-6 py-3 font-medium">Статус</th>
            <th className="text-left px-6 py-3 font-medium">Создан</th>
            <th className="text-right px-6 py-3 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t">
              <td className="px-6 py-3 font-mono text-xs">
                {inv.invoiceNumber}
              </td>
              <td className="px-6 py-3 font-medium">
                {formatRubles(inv.totalKopecks)}
              </td>
              <td className="px-6 py-3">{invoiceStatusLabel(inv.status)}</td>
              <td className="px-6 py-3 text-muted-foreground">
                {inv.createdAt.toLocaleDateString("ru-RU")}
              </td>
              <td className="px-6 py-3">
                <InvoiceRowActions invoice={inv} onChanged={onReload} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
