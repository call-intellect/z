/**
 * API DTO для модуля billing.
 *
 * Источник правды — backend/src/modules/billing/.
 * Доменные модели — `src/domain/billing.ts`.
 */

export type SubscriptionStatusApi =
  | 'DEMO'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'EXPIRED';

export type PaymentModeApi = 'paid' | 'bonus';
export type BillingPeriodApi = 'monthly' | 'yearly';
export type InvoiceStatusApi = 'draft' | 'issued' | 'paid' | 'bonus' | 'void';
export type BillingPaymentMethodApi =
  | 'card_recurring'
  | 'bank_invoice'
  | 'manual_admin'
  | 'bonus';

export interface SubscriptionViewApi {
  status: SubscriptionStatusApi;
  paymentMode: PaymentModeApi | null;
  billingPeriod: BillingPeriodApi | null;
  startedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  seatsBase: number;
  seatsExtra: number;
  monthlyPriceKopecks: number;
  totalPaidKopecks: number;
  autoRenew: boolean;
}

export interface InvoiceViewApi {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatusApi;
  paymentMethod: BillingPaymentMethodApi | null;
  totalKopecks: number;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  pdfUrl: string | null;
}

export interface InvoiceListResponseApi {
  items: InvoiceViewApi[];
  total: number;
}

export interface QuoteApi {
  billingPeriod: BillingPeriodApi;
  seatsExtra: number;
  monthlyKopecks: number;
  periodKopecks: number;
  discountKopecks: number;
  monthsInPeriod: number;
  meetingsGrant: number;
}

export interface MeetingsBalanceApi {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
  lastGrantedAt: string | null;
}

export interface PaymentStartResultApi {
  invoiceId: string;
  invoiceNumber: string;
  totalKopecks: number;
  paymentUrl: string | null;
  providerInvoiceId: string | null;
}

export interface StartCardPaymentBody {
  billingPeriod: BillingPeriodApi;
  seatsExtra: number;
  autoRenew: boolean;
}

export interface StartBankInvoiceBody {
  billingPeriod: BillingPeriodApi;
  seatsExtra: number;
  dueInDays?: number;
  sendToEmail?: boolean;
}

// ────────────────────────── Admin ──────────────────────────

export interface AdminActivateBody {
  billingPeriod: BillingPeriodApi;
  seatsBase?: number;
  seatsExtra: number;
  startedAt: string;
  paymentMode: PaymentModeApi;
  reason: string;
  externalRef?: string;
}

export interface AdminActivateResultApi {
  subscriptionId: string;
  invoiceId: string;
  grantedMeetings: number;
}

export interface AdminAdjustSeatsBody {
  newSeatsExtra: number;
  reason: string;
  daysLeftInMonthlyPeriod?: number;
  monthsLeftInYearlyPeriod?: number;
}

export interface AdminForceStatusBody {
  newStatus: SubscriptionStatusApi;
  reason: string;
}

export interface AdminMarkPaidBody {
  externalRef?: string;
  reason: string;
}

export interface AdminVoidInvoiceBody {
  reason: string;
}

export interface AdminOrgBillingResponseApi {
  subscription: SubscriptionViewApi | null;
  recentInvoices: InvoiceViewApi[];
}

export interface SubscriptionEventApi {
  id: string;
  eventType: string;
  payload: unknown;
  byUserId: string | null;
  reason: string | null;
  createdAt: string;
}
