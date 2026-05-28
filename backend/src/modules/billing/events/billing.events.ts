/**
 * Типизированные события биллинга, эмитятся через `@nestjs/event-emitter`
 * (глобально подключён в Z; см. AppModule).
 *
 * Подписчики (handlers):
 *   - `ReferralPayoutService.onInvoicePaid` (Фаза 6) — реф-комиссии.
 *   - Метрики/телеметрия — в любых будущих модулях.
 *
 * НЕ заменяет `BillingEventLog` (он для аудита/дедупа webhook'ов). События —
 * это «толкач» для side-effect'ов после транзакции (fire-and-forget).
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.1 + §9.
 */

/** Имена событий — строки чтобы избежать `keyof typeof` на enum. */
export const BillingEvent = {
  /** Инвойс отмечен оплаченным (paymentMode=paid). Триггер реф-комиссии. */
  INVOICE_PAID: 'billing.invoice.paid',
  /** Инвойс bonus-активирован — НЕ триггерит реф-комиссию. */
  INVOICE_BONUS: 'billing.invoice.bonus',
  /** Инвойс отменён админом. */
  INVOICE_VOIDED: 'billing.invoice.voided',

  /** Подписка активирована в paid-режиме (новая или продление). */
  SUBSCRIPTION_ACTIVATED_PAID: 'billing.subscription.activated_paid',
  /** Подписка активирована в bonus-режиме. */
  SUBSCRIPTION_ACTIVATED_BONUS: 'billing.subscription.activated_bonus',
  /** Период подписки истёк — переход в EXPIRED. */
  SUBSCRIPTION_EXPIRED: 'billing.subscription.expired',
  /** Подписка переведена в PAST_DUE (autopay не прошёл). */
  SUBSCRIPTION_PAST_DUE: 'billing.subscription.past_due',
  /** Изменилось число мест (seatsExtra). */
  SUBSCRIPTION_SEATS_CHANGED: 'billing.subscription.seats_changed',
} as const;
export type BillingEventName = (typeof BillingEvent)[keyof typeof BillingEvent];

// ────────────────────────── Payloads ──────────────────────────

export interface InvoicePaidPayload {
  invoiceId: string;
  tenantId: string;
  subscriptionId: string | null;
  amountKopecks: number;
  paymentMode: 'paid' | 'bonus';
  paidAt: Date;
}

export interface InvoiceVoidedPayload {
  invoiceId: string;
  tenantId: string;
  reason: string;
  byUserId: string | null;
}

export interface SubscriptionActivatedPayload {
  tenantId: string;
  subscriptionId: string;
  paymentMode: 'paid' | 'bonus';
  billingPeriod: 'monthly' | 'yearly';
  periodStart: Date;
  periodEnd: Date;
  seatsBase: number;
  seatsExtra: number;
}

export interface SubscriptionExpiredPayload {
  tenantId: string;
  subscriptionId: string;
}

export interface SubscriptionSeatsChangedPayload {
  tenantId: string;
  subscriptionId: string;
  seatsExtraBefore: number;
  seatsExtraAfter: number;
}
