/**
 * Domain-модель биллинга. Конвертирует ApiDto → DomainModel и обратно.
 *
 * Ключевые конверсии:
 *   - Денежные суммы: API → копейки (Int), Domain → рубли (number), UI →
 *     отформатированная строка через `formatRubles`.
 *   - Даты: API → ISO string, Domain → Date.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §13.
 */

import type {
  BillingPaymentMethodApi,
  BillingPeriodApi,
  InvoiceStatusApi,
  InvoiceViewApi,
  MeetingsBalanceApi,
  PaymentModeApi,
  QuoteApi,
  SubscriptionStatusApi,
  SubscriptionViewApi,
} from '@/api/types/billing';

// ────────────────────────── Types ──────────────────────────

export type SubscriptionStatus = SubscriptionStatusApi;
export type PaymentMode = PaymentModeApi;
export type BillingPeriod = BillingPeriodApi;
export type InvoiceStatus = InvoiceStatusApi;
export type BillingPaymentMethod = BillingPaymentMethodApi;

export interface SubscriptionDomain {
  status: SubscriptionStatus;
  paymentMode: PaymentMode | null;
  billingPeriod: BillingPeriod | null;
  startedAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  seatsBase: number;
  seatsExtra: number;
  /** Месячная цена в копейках. */
  monthlyPriceKopecks: number;
  /** Сколько всего оплачено за время жизни подписки (копейки). */
  totalPaidKopecks: number;
  autoRenew: boolean;
}

export interface InvoiceDomain {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  paymentMethod: BillingPaymentMethod | null;
  totalKopecks: number;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  pdfUrl: string | null;
}

export interface QuoteDomain {
  billingPeriod: BillingPeriod;
  seatsExtra: number;
  monthlyKopecks: number;
  periodKopecks: number;
  discountKopecks: number;
  monthsInPeriod: number;
  meetingsGrant: number;
}

export interface MeetingsBalanceDomain {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
  lastGrantedAt: Date | null;
}

// ────────────────────────── Mappers ──────────────────────────

export function subscriptionFromApi(
  api: SubscriptionViewApi,
): SubscriptionDomain {
  return {
    status: api.status,
    paymentMode: api.paymentMode,
    billingPeriod: api.billingPeriod,
    startedAt: api.startedAt ? new Date(api.startedAt) : null,
    currentPeriodStart: api.currentPeriodStart
      ? new Date(api.currentPeriodStart)
      : null,
    currentPeriodEnd: api.currentPeriodEnd
      ? new Date(api.currentPeriodEnd)
      : null,
    seatsBase: api.seatsBase,
    seatsExtra: api.seatsExtra,
    monthlyPriceKopecks: api.monthlyPriceKopecks,
    totalPaidKopecks: api.totalPaidKopecks,
    autoRenew: api.autoRenew,
  };
}

export function invoiceFromApi(api: InvoiceViewApi): InvoiceDomain {
  return {
    id: api.id,
    invoiceNumber: api.invoiceNumber,
    status: api.status,
    paymentMethod: api.paymentMethod,
    totalKopecks: api.totalKopecks,
    periodStart: new Date(api.periodStart),
    periodEnd: new Date(api.periodEnd),
    paidAt: api.paidAt ? new Date(api.paidAt) : null,
    voidedAt: api.voidedAt ? new Date(api.voidedAt) : null,
    createdAt: new Date(api.createdAt),
    pdfUrl: api.pdfUrl,
  };
}

export function quoteFromApi(api: QuoteApi): QuoteDomain {
  return { ...api };
}

export function meetingsBalanceFromApi(
  api: MeetingsBalanceApi,
): MeetingsBalanceDomain {
  return {
    balance: api.balance,
    totalGranted: api.totalGranted,
    totalConsumed: api.totalConsumed,
    lastGrantedAt: api.lastGrantedAt ? new Date(api.lastGrantedAt) : null,
  };
}

// ────────────────────────── Formatters ──────────────────────────

/** Форматирует копейки в рубли: `123_45` → `"1 234,56 ₽"`. */
export function formatRubles(kopecks: number): string {
  const rubles = kopecks / 100;
  return rubles.toLocaleString('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: rubles % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Лейбл периода для UI. */
export function billingPeriodLabel(p: BillingPeriod | null): string {
  if (!p) return '—';
  return p === 'yearly' ? 'Годовая' : 'Месячная';
}

/** Лейбл статуса подписки. */
export function subscriptionStatusLabel(s: SubscriptionStatus): string {
  const map: Record<SubscriptionStatus, string> = {
    DEMO: 'Демо',
    ACTIVE: 'Активна',
    PAST_DUE: 'Просрочка',
    SUSPENDED: 'Приостановлена',
    CANCELED: 'Отменена',
    EXPIRED: 'Истекла',
  };
  return map[s];
}

/** Цвет badge для статуса (для Tailwind). */
export function subscriptionStatusColor(
  s: SubscriptionStatus,
): 'green' | 'amber' | 'red' | 'slate' {
  switch (s) {
    case 'ACTIVE':
      return 'green';
    case 'PAST_DUE':
      return 'amber';
    case 'SUSPENDED':
    case 'EXPIRED':
      return 'red';
    case 'CANCELED':
    case 'DEMO':
    default:
      return 'slate';
  }
}

/** Лейбл способа оплаты. */
export function paymentMethodLabel(m: BillingPaymentMethod | null): string {
  if (!m) return '—';
  const map: Record<BillingPaymentMethod, string> = {
    card_recurring: 'Карта (автопродление)',
    bank_invoice: 'Безналичная оплата',
    manual_admin: 'Ручная активация',
    bonus: 'Бонус',
  };
  return map[m];
}

/** Лейбл статуса инвойса. */
export function invoiceStatusLabel(s: InvoiceStatus): string {
  const map: Record<InvoiceStatus, string> = {
    draft: 'Черновик',
    issued: 'Выставлен',
    paid: 'Оплачен',
    bonus: 'Бонус',
    void: 'Отменён',
  };
  return map[s];
}

/** Лейбл режима оплаты (paid/bonus). */
export function paymentModeLabel(m: PaymentMode | null): string {
  if (!m) return '—';
  return m === 'paid' ? 'Оплачено' : 'Бонус';
}
