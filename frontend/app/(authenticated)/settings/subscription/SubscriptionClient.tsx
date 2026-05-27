'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Receipt,
  Users,
  Video,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { billingApi } from '@/api/billing.api';
import {
  billingPeriodLabel,
  formatRubles,
  invoiceFromApi,
  invoiceStatusLabel,
  meetingsBalanceFromApi,
  paymentMethodLabel,
  subscriptionFromApi,
  subscriptionStatusColor,
  subscriptionStatusLabel,
  type InvoiceDomain,
  type MeetingsBalanceDomain,
  type SubscriptionDomain,
} from '@/domain/billing';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * `/settings/subscription` — кабинет подписки.
 *
 * Что показываем:
 *   - Карточка текущей подписки (status, период, цена, autoRenew, seats)
 *   - Баланс встреч (накопительный, см. MeetingsBalanceService)
 *   - Список инвойсов с возможностью скачать PDF
 *   - CTA «Оплатить картой» / «Выставить счёт» (feature-flag по бэку)
 *
 * Все суммы — копейки → форматируются через formatRubles.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.1 + §13.
 */
export function SubscriptionClient() {
  const [subscription, setSubscription] = useState<SubscriptionDomain | null>(null);
  const [balance, setBalance] = useState<MeetingsBalanceDomain | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState<'card' | 'bank' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [subRes, balRes, invRes] = await Promise.all([
          billingApi.getSubscription(),
          billingApi.getMeetingsBalance(),
          billingApi.getInvoices({ limit: 20 }),
        ]);
        if (cancelled) return;
        setSubscription(subRes ? subscriptionFromApi(subRes) : null);
        setBalance(meetingsBalanceFromApi(balRes));
        setInvoices(invRes.items.map(invoiceFromApi));
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof ApiError ? e.message : 'Не удалось загрузить данные';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePayCard = async () => {
    setPayLoading('card');
    try {
      const result = await billingApi.payCard({
        billingPeriod: 'monthly',
        seatsExtra: 0,
        autoRenew: true,
      });
      if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }
      // Edge case: paymentUrl null — показать инструкцию через инвойс.
      setError('Платёжная ссылка не получена. Свяжитесь с поддержкой.');
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : 'Не удалось создать платёж';
      setError(message);
    } finally {
      setPayLoading(null);
    }
  };

  const handlePayBankInvoice = async () => {
    setPayLoading('bank');
    try {
      const result = await billingApi.payBankInvoice({
        billingPeriod: 'monthly',
        seatsExtra: 0,
        sendToEmail: true,
      });
      // После создания инвойса — обновляем список.
      const invRes = await billingApi.getInvoices({ limit: 20 });
      setInvoices(invRes.items.map(invoiceFromApi));
      if (result.invoiceId) {
        setError(null);
      }
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : 'Не удалось выставить счёт';
      setError(message);
    } finally {
      setPayLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Ошибка загрузки</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Подписка и оплата</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управление подпиской tier_standard, оплата картой или безналом,
          история счетов.
        </p>
      </div>

      <SubscriptionCard subscription={subscription} balance={balance} />

      <PaySection
        subscription={subscription}
        onPayCard={handlePayCard}
        onPayBankInvoice={handlePayBankInvoice}
        loading={payLoading}
      />

      <InvoicesTable invoices={invoices} />
    </div>
  );
}

// ────────────────────────── SubscriptionCard ──────────────────────────

function SubscriptionCard({
  subscription,
  balance,
}: {
  subscription: SubscriptionDomain | null;
  balance: MeetingsBalanceDomain | null;
}) {
  if (!subscription) {
    return (
      <div className="rounded-lg border bg-card p-6 space-y-2">
        <h2 className="text-lg font-medium">Подписка не активирована</h2>
        <p className="text-sm text-muted-foreground">
          После регистрации Org находится в режиме DEMO. Активируйте подписку,
          оплатив картой или выставив счёт.
        </p>
      </div>
    );
  }

  const statusColor = subscriptionStatusColor(subscription.status);
  const statusBadgeClass = {
    green: 'bg-green-100 text-green-900',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-900',
    slate: 'bg-slate-100 text-slate-900',
  }[statusColor];

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium">Текущая подписка</h2>
          <p className="text-sm text-muted-foreground">
            tier_standard
            {subscription.billingPeriod
              ? ` · ${billingPeriodLabel(subscription.billingPeriod)}`
              : ''}
          </p>
        </div>
        <Badge className={statusBadgeClass}>
          {subscriptionStatusLabel(subscription.status)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Field
          icon={<CreditCard className="w-4 h-4" />}
          label="Цена / месяц"
          value={formatRubles(subscription.monthlyPriceKopecks)}
        />
        <Field
          icon={<Users className="w-4 h-4" />}
          label="Места"
          value={`${subscription.seatsBase + 1} основ. + ${subscription.seatsExtra} доп.`}
        />
        <Field
          icon={<Calendar className="w-4 h-4" />}
          label="Текущий период"
          value={
            subscription.currentPeriodStart && subscription.currentPeriodEnd
              ? `${subscription.currentPeriodStart.toLocaleDateString('ru-RU')} — ${subscription.currentPeriodEnd.toLocaleDateString('ru-RU')}`
              : '—'
          }
        />
        <Field
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Автопродление"
          value={subscription.autoRenew ? 'Включено' : 'Выключено'}
        />
        {balance && (
          <>
            <Field
              icon={<Video className="w-4 h-4" />}
              label="Баланс встреч"
              value={`${balance.balance} осталось`}
            />
            <Field
              icon={<Video className="w-4 h-4" />}
              label="Всего проведено"
              value={`${balance.totalConsumed} встреч`}
            />
          </>
        )}
      </dl>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-muted-foreground mb-1 text-xs uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// ────────────────────────── Pay section ──────────────────────────

function PaySection({
  subscription,
  onPayCard,
  onPayBankInvoice,
  loading,
}: {
  subscription: SubscriptionDomain | null;
  onPayCard: () => void;
  onPayBankInvoice: () => void;
  loading: 'card' | 'bank' | null;
}) {
  const isActive = subscription?.status === 'ACTIVE';
  const titleText = isActive
    ? 'Продление подписки'
    : 'Оплатить и активировать';

  return (
    <div className="rounded-lg border bg-card p-6 space-y-3">
      <h2 className="text-lg font-medium">{titleText}</h2>
      <p className="text-sm text-muted-foreground">
        tier_standard — 60 000 ₽/мес или 576 000 ₽/год (скидка 20%). Каждое
        дополнительное место — +1 000 ₽/мес.
      </p>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={onPayCard} disabled={loading !== null}>
          {loading === 'card' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CreditCard className="w-4 h-4" />
          )}
          <span>Оплатить картой</span>
        </Button>
        <Button
          variant="outline"
          onClick={onPayBankInvoice}
          disabled={loading !== null}
        >
          {loading === 'bank' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          <span>Выставить счёт (безнал)</span>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground pt-2">
        Безналичная оплата требует заполненных реквизитов Org (ИНН, адрес,
        директор). Заполнить можно в разделе «Организация».
      </p>
    </div>
  );
}

// ────────────────────────── Invoices ──────────────────────────

function InvoicesTable({ invoices }: { invoices: InvoiceDomain[] }) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-medium mb-2">Счета</h2>
        <p className="text-sm text-muted-foreground">
          Пока нет ни одного счёта. Они появятся после первой оплаты или
          активации подписки администратором.
        </p>
      </div>
    );
  }

  const statusBadgeClass: Record<string, string> = {
    paid: 'bg-green-100 text-green-900',
    bonus: 'bg-blue-100 text-blue-900',
    issued: 'bg-amber-100 text-amber-900',
    draft: 'bg-slate-100 text-slate-900',
    void: 'bg-red-100 text-red-900',
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          Счета
        </h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-6 py-3 font-medium">Номер</th>
            <th className="text-left px-6 py-3 font-medium">Период</th>
            <th className="text-left px-6 py-3 font-medium">Сумма</th>
            <th className="text-left px-6 py-3 font-medium">Статус</th>
            <th className="text-left px-6 py-3 font-medium">Способ</th>
            <th className="text-right px-6 py-3 font-medium">PDF</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t">
              <td className="px-6 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
              <td className="px-6 py-3">
                {inv.periodStart.toLocaleDateString('ru-RU')} —{' '}
                {inv.periodEnd.toLocaleDateString('ru-RU')}
              </td>
              <td className="px-6 py-3 font-medium">
                {formatRubles(inv.totalKopecks)}
              </td>
              <td className="px-6 py-3">
                <Badge
                  className={
                    statusBadgeClass[inv.status] ?? 'bg-slate-100 text-slate-900'
                  }
                >
                  {invoiceStatusLabel(inv.status)}
                </Badge>
              </td>
              <td className="px-6 py-3 text-muted-foreground">
                {paymentMethodLabel(inv.paymentMethod)}
              </td>
              <td className="px-6 py-3 text-right">
                {inv.pdfUrl ? (
                  <a
                    href={inv.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Download className="w-4 h-4" />
                    Скачать
                  </a>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
