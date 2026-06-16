export const BillingEvent = {
  INVOICE_PAID: 'billing.invoice.paid',
  INVOICE_BONUS: 'billing.invoice.bonus',
  INVOICE_VOIDED: 'billing.invoice.voided',

  SUBSCRIPTION_ACTIVATED_PAID: 'billing.subscription.activated_paid',
  SUBSCRIPTION_ACTIVATED_BONUS: 'billing.subscription.activated_bonus',
  SUBSCRIPTION_EXPIRED: 'billing.subscription.expired',
  SUBSCRIPTION_PAST_DUE: 'billing.subscription.past_due',
  SUBSCRIPTION_SEATS_CHANGED: 'billing.subscription.seats_changed',
} as const;
export type BillingEventName = (typeof BillingEvent)[keyof typeof BillingEvent];

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
