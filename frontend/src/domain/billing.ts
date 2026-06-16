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
} from "@/api/types/billing";

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
  monthlyPriceKopecks: number;
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

export function formatRubles(kopecks: number): string {
  const rubles = kopecks / 100;
  return rubles.toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: rubles % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function billingPeriodLabel(p: BillingPeriod | null): string {
  if (!p) return "—";
  return p === "yearly" ? "Годовая" : "Месячная";
}

export function subscriptionStatusLabel(s: SubscriptionStatus): string {
  const map: Record<SubscriptionStatus, string> = {
    DEMO: "Демо",
    ACTIVE: "Активна",
    PAST_DUE: "Просрочка",
    SUSPENDED: "Приостановлена",
    CANCELED: "Отменена",
    EXPIRED: "Истекла",
  };
  return map[s];
}

export function subscriptionStatusColor(
  s: SubscriptionStatus,
): "green" | "amber" | "red" | "slate" {
  switch (s) {
    case "ACTIVE":
      return "green";
    case "PAST_DUE":
      return "amber";
    case "SUSPENDED":
    case "EXPIRED":
      return "red";
    case "CANCELED":
    case "DEMO":
    default:
      return "slate";
  }
}

export function paymentMethodLabel(m: BillingPaymentMethod | null): string {
  if (!m) return "—";
  const map: Record<BillingPaymentMethod, string> = {
    card_recurring: "Карта (автопродление)",
    bank_invoice: "Безналичная оплата",
    manual_admin: "Ручная активация",
    bonus: "Бонус",
  };
  return map[m];
}

export function invoiceStatusLabel(s: InvoiceStatus): string {
  const map: Record<InvoiceStatus, string> = {
    draft: "Черновик",
    issued: "Выставлен",
    paid: "Оплачен",
    bonus: "Бонус",
    void: "Отменён",
  };
  return map[s];
}

export type SubscriptionEventType =
  | "created"
  | "activated_paid"
  | "activated_bonus"
  | "renewed"
  | "past_due"
  | "suspended"
  | "canceled"
  | "expired"
  | "seats_changed"
  | "status_forced"
  | "provider_recurring_canceled";

const SUBSCRIPTION_EVENT_LABELS: Record<SubscriptionEventType, string> = {
  created: "Создана",
  activated_paid: "Активирована (paid)",
  activated_bonus: "Активирована (bonus)",
  renewed: "Продлено",
  past_due: "Просрочка",
  suspended: "Приостановлена",
  canceled: "Отменена",
  expired: "Истекла",
  seats_changed: "Изменены места",
  status_forced: "Принудительная смена статуса",
  provider_recurring_canceled: "Авто-продление отменено провайдером",
};

export function subscriptionEventLabel(eventType: string): string {
  return (
    SUBSCRIPTION_EVENT_LABELS[eventType as SubscriptionEventType] ?? eventType
  );
}

export type SubscriptionEventColor =
  | "green"
  | "amber"
  | "red"
  | "slate"
  | "blue";

export function subscriptionEventColor(
  eventType: string,
): SubscriptionEventColor {
  switch (eventType as SubscriptionEventType) {
    case "created":
    case "activated_paid":
    case "activated_bonus":
    case "renewed":
      return "green";
    case "past_due":
    case "seats_changed":
      return "amber";
    case "suspended":
    case "canceled":
    case "expired":
    case "status_forced":
      return "red";
    case "provider_recurring_canceled":
      return "blue";
    default:
      return "slate";
  }
}
