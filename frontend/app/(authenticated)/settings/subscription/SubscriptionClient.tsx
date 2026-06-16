'use client';

/**
 * `/settings/subscription` — кабинет подписки (Фаза 3 paywall-no-trial).
 *
 * Что показываем:
 *   - DEMO hero: крупный заголовок «Оплатите подписку, чтобы начать работу»
 *     + конфигуратор (период + места) + CTA-кнопки.
 *   - ACTIVE: текущая подписка + баланс + продление.
 *   - SUSPENDED/EXPIRED/CANCELED: статус + CTA на возобновление.
 *   - Конфигуратор: toggle месяц/год, slider мест 31-100, live-расчёт через
 *     billingApi.getQuote().
 *   - Инвойсы (таблица с PDF).
 *
 * Все суммы — копейки → форматируются через formatRubles.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §5.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Lock,
  Receipt,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { billingApi } from '@/api/billing.api';
import type { BillingPeriodApi, SubscriptionStatusApi } from '@/api/types/billing';
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
  type QuoteDomain,
  type SubscriptionDomain,
} from '@/domain/billing';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Slider } from '@/ui/shadcn/slider';

// ────────────────────────── Constants ──────────────────────────

const BASE_SEATS = 31;
const MIN_SEATS = BASE_SEATS;
const MAX_SEATS = 100;
const STEP = 1;

const DEMO_FEATURES = [
  '150 видеовстреч в месяц',
  `${BASE_SEATS} мест для пользователей`,
  'Безлимитные проекты и задачи',
  'Отчёты Коры и граф знаний',
  'Клоны сотрудников',
  'Все интеграции',
];

// ────────────────────────── Main ──────────────────────────

export function SubscriptionClient() {
  const [subscription, setSubscription] = useState<SubscriptionDomain | null>(null);
  const [balance, setBalance] = useState<MeetingsBalanceDomain | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState<'card' | 'bank' | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subRes, balRes, invRes] = await Promise.all([
        billingApi.getSubscription(),
        billingApi.getMeetingsBalance(),
        billingApi.getInvoices({ limit: 20 }),
      ]);
      setSubscription(subRes ? subscriptionFromApi(subRes) : null);
      setBalance(meetingsBalanceFromApi(balRes));
      setInvoices(invRes.items.map(invoiceFromApi));
    } catch (e) {
      const message =
        humanizeApiError(e, 'Не удалось загрузить данные');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handlePayCard = async (period: BillingPeriodApi, seatsExtra: number) => {
    setPayLoading('card');
    try {
      const result = await billingApi.payCard({
        billingPeriod: period,
        seatsExtra,
        autoRenew: true,
      });
      if (result.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }
      setError('Платёжная ссылка не получена. Свяжитесь с поддержкой.');
    } catch (e) {
      const message =
        humanizeApiError(e, 'Не удалось создать платёж');
      setError(message);
    } finally {
      setPayLoading(null);
    }
  };

  const handlePayBankInvoice = async (period: BillingPeriodApi, seatsExtra: number) => {
    setPayLoading('bank');
    try {
      const result = await billingApi.payBankInvoice({
        billingPeriod: period,
        seatsExtra,
        sendToEmail: true,
      });
      const invRes = await billingApi.getInvoices({ limit: 20 });
      setInvoices(invRes.items.map(invoiceFromApi));
      if (result.invoiceId) {
        setError(null);
      }
    } catch (e) {
      const message =
        humanizeApiError(e, 'Не удалось выставить счёт');
      setError(message);
    } finally {
      setPayLoading(null);
    }
  };

  const isDemo = subscription?.status === 'DEMO' || subscription === null;
  const isActive = subscription?.status === 'ACTIVE';
  const isBlocked = subscription?.status === 'SUSPENDED'
    || subscription?.status === 'EXPIRED'
    || subscription?.status === 'CANCELED'
    || subscription?.status === 'PAST_DUE';

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {isDemo && (
        <DemoHero
          onPayCard={handlePayCard}
          onPayBankInvoice={handlePayBankInvoice}
          payLoading={payLoading}
        />
      )}

      {isActive && (
        <>
          <SubscriptionCard subscription={subscription!} balance={balance} />
          <RenewalSection
            onPayCard={handlePayCard}
            onPayBankInvoice={handlePayBankInvoice}
            payLoading={payLoading}
          />
        </>
      )}

      {isBlocked && (
        <BlockedHero
          status={subscription!.status}
          onPayCard={handlePayCard}
          onPayBankInvoice={handlePayBankInvoice}
          payLoading={payLoading}
        />
      )}

      <InvoicesTable invoices={invoices} />
    </div>
  );
}

// ────────────────────────── DEMO Hero (3.1 + 3.2 + 3.3) ──────────────────────────

function DemoHero({
  onPayCard,
  onPayBankInvoice,
  payLoading,
}: {
  onPayCard: (period: BillingPeriodApi, seatsExtra: number) => void;
  onPayBankInvoice: (period: BillingPeriodApi, seatsExtra: number) => void;
  payLoading: 'card' | 'bank' | null;
}) {
  const [period, setPeriod] = useState<BillingPeriodApi>('monthly');
  const [seats, setSeats] = useState(BASE_SEATS);
  const seatsExtra = Math.max(0, seats - BASE_SEATS);

  const quote = useQuote(period, seatsExtra);

  return (
    <div className="space-y-6">
      <div className="text-center" data-testid="demo-hero">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-muted">
          <Lock size={28} className="text-accent" />
        </div>
        <h1 className="text-3xl font-bold text-fg-primary">
          Оплатите подписку, чтобы начать работу
        </h1>
        <p className="mt-2 text-fg-secondary">
          Сейчас вы в демо-режиме: просмотр данных без возможности создания.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PricingConfigurator
          period={period}
          onPeriodChange={setPeriod}
          seats={seats}
          onSeatsChange={setSeats}
          quote={quote}
          seatsExtra={seatsExtra}
        />

        <div className="space-y-4">
          <Card className="p-6">
            <h3 className="mb-3 text-sm font-semibold text-fg-primary">
              Что включено:
            </h3>
            <ul className="space-y-2">
              {DEMO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Check size={16} className="shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-2">
            <Button
              size="lg"
              className="w-full"
              disabled={payLoading !== null}
              onClick={() => onPayCard(period, seatsExtra)}
              data-testid="pay-card-btn"
            >
              {payLoading === 'card' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CreditCard size={16} />
              )}
              Оплатить картой
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              disabled={payLoading !== null}
              onClick={() => onPayBankInvoice(period, seatsExtra)}
              data-testid="pay-bank-btn"
            >
              {payLoading === 'bank' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FileText size={16} />
              )}
              Безналичный расчёт
            </Button>
          </div>

          {seatsExtra > 0 && (
            <p className="text-center text-xs text-fg-tertiary">
              Доп. места: +1 000 ₽/мес за каждого пользователя сверх {BASE_SEATS}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────── Pricing Configurator (3.2 + 3.3) ──────────────────────────

function PricingConfigurator({
  period,
  onPeriodChange,
  seats,
  onSeatsChange,
  quote,
  seatsExtra,
}: {
  period: BillingPeriodApi;
  onPeriodChange: (p: BillingPeriodApi) => void;
  seats: number;
  onSeatsChange: (n: number) => void;
  quote: QuoteDomain | null;
  seatsExtra: number;
}) {
  const monthlyRubles = quote ? quote.monthlyKopecks / 100 : null;
  const periodRubles = quote ? quote.periodKopecks / 100 : null;
  const discountRubles = quote ? quote.discountKopecks / 100 : null;

  return (
    <Card className="p-6 space-y-6" data-testid="pricing-configurator">
      <div>
        <h2 className="text-lg font-semibold text-fg-primary">Настройте подписку</h2>
        <p className="text-sm text-fg-tertiary">Выберите период и количество мест</p>
      </div>

      {/* Period toggle (3.2) */}
      <div>
        <label className="mb-2 block text-sm font-medium text-fg-secondary">
          Период оплаты
        </label>
        <div className="flex rounded-lg border border-border-subtle p-1" data-testid="period-toggle">
          <button
            type="button"
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              period === 'monthly'
                ? 'bg-accent text-accent-fg shadow-sm'
                : 'text-fg-secondary hover:text-fg-primary'
            }`}
            onClick={() => onPeriodChange('monthly')}
          >
            Месяц
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              period === 'yearly'
                ? 'bg-accent text-accent-fg shadow-sm'
                : 'text-fg-secondary hover:text-fg-primary'
            }`}
            onClick={() => onPeriodChange('yearly')}
          >
            Год
            <span className="ml-1.5 inline-block rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-success">
              −20%
            </span>
          </button>
        </div>
      </div>

      {/* Seats slider (3.3) */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-sm font-medium text-fg-secondary">
            Количество мест
          </label>
          <span className="text-lg font-bold tabular-nums text-fg-primary" data-testid="seats-count">
            {seats}
          </span>
        </div>
        <Slider
          value={[seats]}
          onValueChange={([v]) => onSeatsChange(v)}
          min={MIN_SEATS}
          max={MAX_SEATS}
          step={STEP}
          data-testid="seats-slider"
        />
        <div className="mt-1 flex justify-between text-xs text-fg-tertiary">
          <span>{MIN_SEATS}</span>
          <span>{MAX_SEATS}</span>
        </div>
        {seatsExtra > 0 && (
          <p className="mt-1 text-xs text-fg-tertiary" data-testid="extra-seats-note">
            {seatsExtra} доп. {seatsExtra === 1 ? 'место' : seatsExtra < 5 ? 'места' : 'мест'} × 1 000 ₽/мес
          </p>
        )}
      </div>

      {/* Price summary */}
      <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg-secondary">В месяц:</span>
          <span className="text-2xl font-bold tabular-nums text-fg-primary" data-testid="price-monthly">
            {monthlyRubles !== null ? `${monthlyRubles.toLocaleString('ru-RU')} ₽` : '—'}
          </span>
        </div>
        {period === 'yearly' && periodRubles !== null && (
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-fg-secondary">За год:</span>
            <span className="text-lg font-semibold tabular-nums text-fg-primary" data-testid="price-period">
              {periodRubles.toLocaleString('ru-RU')} ₽
            </span>
          </div>
        )}
        {discountRubles !== null && discountRubles > 0 && (
          <div className="flex items-baseline justify-between text-success">
            <span className="text-sm">Экономия:</span>
            <span className="text-sm font-medium" data-testid="price-discount">
              {discountRubles.toLocaleString('ru-RU')} ₽
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ────────────────────────── Blocked Hero (SUSPENDED/EXPIRED/CANCELED) ──────────────────────────

function BlockedHero({
  status,
  onPayCard,
  onPayBankInvoice,
  payLoading,
}: {
  status: SubscriptionStatusApi;
  onPayCard: (period: BillingPeriodApi, seatsExtra: number) => void;
  onPayBankInvoice: (period: BillingPeriodApi, seatsExtra: number) => void;
  payLoading: 'card' | 'bank' | null;
}) {
  const [period, setPeriod] = useState<BillingPeriodApi>('monthly');
  const [seats, setSeats] = useState(BASE_SEATS);
  const seatsExtra = Math.max(0, seats - BASE_SEATS);
  const quote = useQuote(period, seatsExtra);

  const titles: Record<string, string> = {
    SUSPENDED: 'Подписка приостановлена',
    EXPIRED: 'Подписка истекла',
    CANCELED: 'Подписка отменена',
    PAST_DUE: 'Не получилось списать оплату',
  };

  const descriptions: Record<string, string> = {
    SUSPENDED: 'Оплатите подписку, чтобы возобновить доступ ко всем функциям.',
    EXPIRED: 'Срок подписки истёк. Оплатите, чтобы восстановить доступ к данным.',
    CANCELED: 'Подписка была отменена. Оплатите, чтобы возобновить работу.',
    PAST_DUE: 'Платёж не прошёл. Оплатите снова, чтобы избежать приостановки.',
  };

  const monthlyRubles = quote ? quote.monthlyKopecks / 100 : null;

  return (
    <div className="space-y-6">
      <div className="text-center" data-testid="blocked-hero">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-danger/15">
          <AlertCircle size={28} className="text-danger" />
        </div>
        <h1 className="text-2xl font-bold text-fg-primary">
          {titles[status] ?? 'Проблема с подпиской'}
        </h1>
        <p className="mt-2 text-fg-secondary">
          {descriptions[status] ?? 'Обратитесь в поддержку.'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6 space-y-6">
          <PricingConfigurator
            period={period}
            onPeriodChange={setPeriod}
            seats={seats}
            onSeatsChange={setSeats}
            quote={quote}
            seatsExtra={seatsExtra}
          />
        </Card>

        <div className="space-y-3">
          <div className="text-3xl font-bold text-fg-primary">
            {monthlyRubles !== null ? `${monthlyRubles.toLocaleString('ru-RU')} ₽` : '—'}
            <span className="text-base font-normal text-fg-tertiary">/мес</span>
          </div>
          <Button
            size="lg"
            className="w-full"
            disabled={payLoading !== null}
            onClick={() => onPayCard(period, seatsExtra)}
          >
            {payLoading === 'card' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CreditCard size={16} />
            )}
            Оплатить картой
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={payLoading !== null}
            onClick={() => onPayBankInvoice(period, seatsExtra)}
          >
            {payLoading === 'bank' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileText size={16} />
            )}
            Безналичный расчёт
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────── SubscriptionCard (ACTIVE) ──────────────────────────

function SubscriptionCard({
  subscription,
  balance,
}: {
  subscription: SubscriptionDomain;
  balance: MeetingsBalanceDomain | null;
}) {
  const statusColor = subscriptionStatusColor(subscription.status);
  const badgeVariant: 'success' | 'warning' | 'danger' | 'secondary' = {
    green: 'success' as const,
    amber: 'warning' as const,
    red: 'danger' as const,
    slate: 'secondary' as const,
  }[statusColor];

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Текущая подписка</h2>
          <p className="text-sm text-fg-tertiary">
            Стандартный
            {subscription.billingPeriod
              ? ` · ${billingPeriodLabel(subscription.billingPeriod)}`
              : ''}
          </p>
        </div>
        <Badge variant={badgeVariant}>
          {subscriptionStatusLabel(subscription.status)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Field
          icon={<CreditCard size={16} />}
          label="Цена / месяц"
          value={formatRubles(subscription.monthlyPriceKopecks)}
        />
        <Field
          icon={<Users size={16} />}
          label="Места"
          value={`${subscription.seatsBase} основ. + ${subscription.seatsExtra} доп.`}
        />
        <Field
          icon={<Calendar size={16} />}
          label="Текущий период"
          value={
            subscription.currentPeriodStart && subscription.currentPeriodEnd
              ? `${subscription.currentPeriodStart.toLocaleDateString('ru-RU')} — ${subscription.currentPeriodEnd.toLocaleDateString('ru-RU')}`
              : '—'
          }
        />
        <Field
          icon={<CheckCircle2 size={16} />}
          label="Автопродление"
          value={subscription.autoRenew ? 'Включено' : 'Выключено'}
        />
        {balance && (
          <>
            <Field
              icon={<Video size={16} />}
              label="Баланс встреч"
              value={`${balance.balance} осталось`}
            />
            <Field
              icon={<Video size={16} />}
              label="Всего проведено"
              value={`${balance.totalConsumed} встреч`}
            />
          </>
        )}
      </dl>
    </Card>
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
      <dt className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-fg-tertiary">
        {icon}
        <span>{label}</span>
      </dt>
      <dd className="font-medium text-fg-primary">{value}</dd>
    </div>
  );
}

// ────────────────────────── Renewal Section (ACTIVE) ──────────────────────────

function RenewalSection({
  onPayCard,
  onPayBankInvoice,
  payLoading,
}: {
  onPayCard: (period: BillingPeriodApi, seatsExtra: number) => void;
  onPayBankInvoice: (period: BillingPeriodApi, seatsExtra: number) => void;
  payLoading: 'card' | 'bank' | null;
}) {
  const [period, setPeriod] = useState<BillingPeriodApi>('monthly');
  const [seats, setSeats] = useState(BASE_SEATS);
  const seatsExtra = Math.max(0, seats - BASE_SEATS);
  const quote = useQuote(period, seatsExtra);

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Продление подписки</h2>
        <p className="text-sm text-fg-tertiary">
          Стандартный — 60 000 ₽/мес или 576 000 ₽/год (скидка 20%).
          Каждое дополнительное место — +1 000 ₽/мес.
        </p>
      </div>

      <PricingConfigurator
        period={period}
        onPeriodChange={setPeriod}
        seats={seats}
        onSeatsChange={setSeats}
        quote={quote}
        seatsExtra={seatsExtra}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => onPayCard(period, seatsExtra)}
          disabled={payLoading !== null}
        >
          {payLoading === 'card' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <CreditCard size={16} />
          )}
          Оплатить картой
        </Button>
        <Button
          variant="outline"
          onClick={() => onPayBankInvoice(period, seatsExtra)}
          disabled={payLoading !== null}
        >
          {payLoading === 'bank' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <FileText size={16} />
          )}
          Выставить счёт (безнал)
        </Button>
      </div>
      <p className="text-xs text-fg-tertiary">
        Безналичная оплата требует заполненных реквизитов компании (ИНН, адрес,
        директор). Заполнить можно в разделе «Организация».
      </p>
    </Card>
  );
}

// ────────────────────────── Invoices ──────────────────────────

function InvoicesTable({ invoices }: { invoices: InvoiceDomain[] }) {
  if (invoices.length === 0) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-2">Счета</h2>
        <p className="text-sm text-fg-tertiary">
          Пока нет ни одного счёта. Они появятся после первой оплаты или
          активации подписки администратором.
        </p>
      </Card>
    );
  }

  const statusBadgeVariant: Record<string, 'success' | 'default' | 'warning' | 'secondary' | 'danger'> = {
    paid: 'success',
    bonus: 'default',
    issued: 'warning',
    draft: 'secondary',
    void: 'danger',
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border-subtle px-6 py-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Receipt size={20} />
          Счета
        </h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-6 py-3 text-left font-medium">Номер</th>
            <th className="px-6 py-3 text-left font-medium">Период</th>
            <th className="px-6 py-3 text-left font-medium">Сумма</th>
            <th className="px-6 py-3 text-left font-medium">Статус</th>
            <th className="px-6 py-3 text-left font-medium">Способ</th>
            <th className="px-6 py-3 text-right font-medium">PDF</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-border-subtle">
              <td className="px-6 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
              <td className="px-6 py-3">
                {inv.periodStart.toLocaleDateString('ru-RU')} —{' '}
                {inv.periodEnd.toLocaleDateString('ru-RU')}
              </td>
              <td className="px-6 py-3 font-medium">
                {formatRubles(inv.totalKopecks)}
              </td>
              <td className="px-6 py-3">
                <Badge variant={statusBadgeVariant[inv.status] ?? 'secondary'}>
                  {invoiceStatusLabel(inv.status)}
                </Badge>
              </td>
              <td className="px-6 py-3 text-fg-tertiary">
                {paymentMethodLabel(inv.paymentMethod)}
              </td>
              <td className="px-6 py-3 text-right">
                {inv.pdfUrl ? (
                  <a
                    href={inv.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <Download size={16} />
                    Скачать
                  </a>
                ) : (
                  <span className="text-xs text-fg-tertiary">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ────────────────────────── ErrorBanner ──────────────────────────

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4">
      <AlertCircle size={20} className="mt-0.5 shrink-0 text-danger" />
      <div className="flex-1">
        <p className="text-sm font-medium text-fg-primary">Ошибка</p>
        <p className="text-sm text-fg-secondary">{message}</p>
      </div>
      <button onClick={onDismiss} className="text-fg-tertiary hover:text-fg-primary">
        <Sparkles size={16} />
      </button>
    </div>
  );
}

// ────────────────────────── useQuote hook ──────────────────────────

function useQuote(period: BillingPeriodApi, seatsExtra: number): QuoteDomain | null {
  const [quote, setQuote] = useState<QuoteDomain | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      billingApi
        .getQuote(period, seatsExtra)
        .then((res) => {
          setQuote({
            billingPeriod: res.billingPeriod,
            seatsExtra: res.seatsExtra,
            monthlyKopecks: res.monthlyKopecks,
            periodKopecks: res.periodKopecks,
            discountKopecks: res.discountKopecks,
            monthsInPeriod: res.monthsInPeriod,
            meetingsGrant: res.meetingsGrant,
          });
        })
        .catch(() => {
          // Тихо оставляем предыдущее значение при ошибке.
        });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [period, seatsExtra]);

  return quote;
}
