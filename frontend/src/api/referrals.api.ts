/**
 * API-слой реферальной программы.
 * Эндпоинты — backend ReferralsController + AdminReferralsController.
 */

import { apiClient } from './api-client';
import type {
  CreateReferralBody,
  ReferralClientApi,
  ReferralPayoutApi,
  ReferralStatsApi,
  ReferralViewApi,
  UpdateReferralBody,
} from './types/referrals';

const BASE = '/api/v1/referrals';
const ADMIN = '/api/v1/admin/referrals';

export const referralsApi = {
  // ── Cabinet ──
  getMe: () => apiClient.get<ReferralViewApi | null>(`${BASE}/me`),
  create: (body: CreateReferralBody) =>
    apiClient.post<ReferralViewApi>(`${BASE}/me`, body),
  update: (body: UpdateReferralBody) =>
    apiClient.patch<ReferralViewApi>(`${BASE}/me`, body),
  verifyInn: () => apiClient.post<ReferralViewApi>(`${BASE}/me/verify-inn`, {}),
  acceptContract: () =>
    apiClient.post<ReferralViewApi>(`${BASE}/me/accept-contract`, {}),
  getStats: () => apiClient.get<ReferralStatsApi | null>(`${BASE}/me/stats`),
  getMyClients: () => apiClient.get<ReferralClientApi[]>(`${BASE}/me/clients`),
  getMyPayouts: () => apiClient.get<ReferralPayoutApi[]>(`${BASE}/me/payouts`),
  attributeCurrentOrg: () =>
    apiClient.post<{ attributed: boolean; slug: string | null }>(
      `${BASE}/attribute-current-org`,
      {},
    ),

  // ── Admin ──
  adminListReferrals: (params?: { limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return apiClient.get<{
      items: Array<
        ReferralViewApi & {
          owner: { id: string; email: string; name: string };
        }
      >;
    }>(`${ADMIN}${qs ? `?${qs}` : ''}`);
  },
  adminGetReferral: (id: string) =>
    apiClient.get<{
      referral: ReferralViewApi;
      clients: ReferralClientApi[];
      payouts: ReferralPayoutApi[];
      stats: ReferralStatsApi;
    }>(`${ADMIN}/${id}`),
  adminListPayouts: (params?: {
    status?: 'pending' | 'paid' | 'void';
    periodMonth?: string;
    limit?: number;
    offset?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.periodMonth) search.set('periodMonth', params.periodMonth);
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return apiClient.get<{ items: ReferralPayoutApi[]; total: number }>(
      `${ADMIN}/payouts${qs ? `?${qs}` : ''}`,
    );
  },
  adminMarkPayoutPaid: (id: string, body: { payoutDocumentUrl?: string }) =>
    apiClient.post<ReferralPayoutApi>(`${ADMIN}/payouts/${id}/mark-paid`, body),
  adminVoidPayout: (id: string, body: { voidReason: string }) =>
    apiClient.post<ReferralPayoutApi>(`${ADMIN}/payouts/${id}/void`, body),
  adminClosePeriod: (periodMonth: string) =>
    apiClient.post<{ paid: number; voided: number; skipped: number }>(
      `${ADMIN}/close-period`,
      { periodMonth },
    ),
};
