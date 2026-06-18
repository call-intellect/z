"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CreditCard,
  FileText,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { ApiError } from "@/api/api-error";
import { billingApi } from "@/api/billing.api";
import type { BillingOverviewApi } from "@/api/types/billing";
import { formatRubles } from "@/domain/billing";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function AdminBillingOverviewClient() {
  const [data, setData] = useState<BillingOverviewApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await billingApi.adminGetOverview();
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-6xl space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-6xl">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">{error ?? "Нет данных"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <TrendingUp className="w-6 h-6" />
            Биллинг overview
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Снимок биллинга на{" "}
            {new Date(data.asOf).toLocaleString("ru-RU", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" />
          Обновить
        </Button>
      </div>

      {}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Banknote className="w-5 h-5" />}
          label="MRR"
          value={formatRubles(data.revenue.mrrKopecks)}
          hint={`${data.subscriptions.activePaid} платящих подписок`}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="ARR"
          value={formatRubles(data.revenue.arrKopecks)}
          hint="MRR × 12"
        />
        <StatCard
          icon={<CreditCard className="w-5 h-5" />}
          label="Доход за месяц"
          value={formatRubles(data.revenue.currentMonthPaidKopecks)}
          hint={`${data.invoices.paidThisMonth} paid-инвойсов`}
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="Всего за время"
          value={formatRubles(data.revenue.totalPaidKopecks)}
          hint="Сумма всех paid-инвойсов"
        />
      </div>

      {}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-4">Подписки по статусам</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusCell
            label="ACTIVE"
            value={data.subscriptions.active}
            colorClass="bg-green-100 text-green-900"
            subline={
              <>
                <span className="text-green-800">
                  {data.subscriptions.activePaid} paid
                </span>
                {" · "}
                <span className="text-blue-800">
                  {data.subscriptions.activeBonus} bonus
                </span>
              </>
            }
          />
          <StatusCell
            label="PAST_DUE"
            value={data.subscriptions.pastDue}
            colorClass="bg-amber-100 text-amber-900"
            subline="Просрочка платежа"
          />
          <StatusCell
            label="SUSPENDED"
            value={data.subscriptions.suspended}
            colorClass="bg-red-100 text-red-900"
            subline="Grace истёк"
          />
          <StatusCell
            label="CANCELED"
            value={data.subscriptions.canceled}
            colorClass="bg-slate-100 text-slate-900"
            subline="Отменили автопродление"
          />
          <StatusCell
            label="EXPIRED"
            value={data.subscriptions.expired}
            colorClass="bg-slate-100 text-slate-900"
            subline="Истекли"
          />
          <StatusCell
            label="DEMO"
            value={data.subscriptions.demo}
            colorClass="bg-slate-100 text-slate-900"
            subline="Ещё не активированы"
          />
          <StatusCell
            label="Всего"
            value={data.subscriptions.total}
            colorClass="bg-primary/10 text-foreground"
            subline="Все Org со подпиской"
          />
        </div>
      </div>

      {}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Инвойсы
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <SimpleField label="Issued" value={data.invoices.totalIssued} />
          <SimpleField label="Paid (всего)" value={data.invoices.totalPaid} />
          <SimpleField
            label="Paid (этот месяц)"
            value={data.invoices.paidThisMonth}
          />
          <SimpleField label="Void" value={data.invoices.totalVoid} />
        </div>
      </div>

      {}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Реферальная программа
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <SimpleField
            label="Активных партнёров"
            value={data.referrals.totalActivePartners}
            icon={<Users className="w-4 h-4" />}
          />
          <SimpleField
            label="К выплате (pending)"
            value={data.referrals.payoutsPending}
            subline={formatRubles(data.referrals.payoutsPendingKopecks)}
          />
          <SimpleField
            label="Выплат за месяц"
            value={data.referrals.payoutsPaidThisMonth}
            subline={formatRubles(data.referrals.payoutsPaidThisMonthKopecks)}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function StatusCell({
  label,
  value,
  colorClass,
  subline,
}: {
  label: string;
  value: number;
  colorClass: string;
  subline: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <Badge className={colorClass}>{label}</Badge>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{subline}</div>
    </div>
  );
}

function SimpleField({
  label,
  value,
  subline,
  icon,
}: {
  label: string;
  value: number;
  subline?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {subline && (
        <div className="text-xs text-muted-foreground mt-0.5">{subline}</div>
      )}
    </div>
  );
}
