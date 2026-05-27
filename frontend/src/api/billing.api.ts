/**
 * API-слой биллинга. Все вызовы через единый apiClient.
 *
 * Эндпоинты — backend BillingController + AdminBillingController +
 * BillingTochkaOAuthController. См. ТЗ §11.
 */

import { apiClient } from './api-client';
import type {
  AdminActivateBody,
  AdminActivateResultApi,
  AdminAdjustSeatsBody,
  AdminForceStatusBody,
  AdminMarkPaidBody,
  AdminOrgBillingResponseApi,
  AdminVoidInvoiceBody,
  InvoiceListResponseApi,
  InvoiceViewApi,
  MeetingsBalanceApi,
  PaymentStartResultApi,
  QuoteApi,
  StartBankInvoiceBody,
  StartCardPaymentBody,
  SubscriptionEventApi,
  SubscriptionViewApi,
} from './types/billing';

const BASE = '/api/v1/billing';
const ADMIN = '/api/v1/admin';

export const billingApi = {
  // ── Cabinet ──
  getSubscription: () =>
    apiClient.get<SubscriptionViewApi | null>(`${BASE}/subscription`),
  getMeetingsBalance: () =>
    apiClient.get<MeetingsBalanceApi>(`${BASE}/meetings-balance`),
  getInvoices: (params?: { limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return apiClient.get<InvoiceListResponseApi>(
      `${BASE}/invoices${qs ? `?${qs}` : ''}`,
    );
  },
  getQuote: (billingPeriod: 'monthly' | 'yearly', seatsExtra: number) =>
    apiClient.get<QuoteApi>(
      `${BASE}/quote?billingPeriod=${billingPeriod}&seatsExtra=${seatsExtra}`,
    ),
  payCard: (body: StartCardPaymentBody) =>
    apiClient.post<PaymentStartResultApi>(`${BASE}/pay/card`, body),
  payBankInvoice: (body: StartBankInvoiceBody) =>
    apiClient.post<PaymentStartResultApi>(`${BASE}/pay/bank-invoice`, body),

  // ── Admin (per-Org) ──
  adminGetOrgBilling: (tenantId: string) =>
    apiClient.get<AdminOrgBillingResponseApi>(
      `${ADMIN}/orgs/${tenantId}/billing`,
    ),
  adminActivate: (tenantId: string, body: AdminActivateBody) =>
    apiClient.post<AdminActivateResultApi>(
      `${ADMIN}/orgs/${tenantId}/billing/activate`,
      body,
    ),
  adminAdjustSeats: (tenantId: string, body: AdminAdjustSeatsBody) =>
    apiClient.post<{
      subscriptionId: string;
      invoiceId: string | null;
      grantedMeetings: number;
    }>(`${ADMIN}/orgs/${tenantId}/billing/adjust-seats`, body),
  adminForceStatus: (tenantId: string, body: AdminForceStatusBody) =>
    apiClient.post<SubscriptionViewApi>(
      `${ADMIN}/orgs/${tenantId}/billing/force-status`,
      body,
    ),
  adminGetEvents: (tenantId: string) =>
    apiClient.get<{ items: SubscriptionEventApi[] }>(
      `${ADMIN}/orgs/${tenantId}/billing/events`,
    ),

  // ── Admin (invoices) ──
  adminMarkInvoicePaid: (invoiceId: string, body: AdminMarkPaidBody) =>
    apiClient.post<InvoiceViewApi>(
      `${ADMIN}/billing/invoices/${invoiceId}/mark-paid`,
      body,
    ),
  adminVoidInvoice: (invoiceId: string, body: AdminVoidInvoiceBody) =>
    apiClient.post<InvoiceViewApi>(
      `${ADMIN}/billing/invoices/${invoiceId}/void`,
      body,
    ),

  // ── Admin (Tochka OAuth) ──
  adminGetTochkaAuthorizeUrl: () =>
    apiClient.get<{ url: string }>(
      `${ADMIN}/billing/tochka/oauth/authorize-url`,
    ),
  adminEnsureTochkaOAuthReady: () =>
    apiClient.post<{ ok: true }>(
      `${ADMIN}/billing/tochka/oauth/ensure-ready`,
      {},
    ),
};
