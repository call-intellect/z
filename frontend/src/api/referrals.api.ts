/**
 * API-слой реферальной программы.
 * Эндпоинты — backend ReferralsController + AdminReferralsController.
 *
 * Обновлено по ТЗ 2026-05-31-referrals-cabinet-revamp:
 *   - `create` — новый body `{ contractAccepted, inn?, legalForm?, payoutDetails? }`.
 *   - `getMyClients` — отдаёт `ReferralClientMaskedApi[]` (§7.4).
 *   - `getStats` — отдаёт `ReferralStatsExtendedApi` (5 legacy + 5 новых 30d полей).
 *   - `getIncomeChart` — 12 точек дохода + активных клиентов за 12 месяцев (§7.3).
 *   - `getFunnel` — воронка за период `30d | 90d | all` (§7.3).
 *   - `trackPromoEvent` — 204 No Content для баннера партнёрской программы (§8.3a).
 */

import { apiClient } from './api-client';
import type {
  CreateReferralBody,
  FunnelApi,
  FunnelPeriodApi,
  MonthlyPointApi,
  PromoEventBody,
  ReferralClientApi,
  ReferralClientMaskedApi,
  ReferralPayoutApi,
  ReferralStatsExtendedApi,
  ReferralViewApi,
  RewardProgressApi,
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
  getStats: () =>
    apiClient.get<ReferralStatsExtendedApi | null>(`${BASE}/me/stats`),
  getMyClients: () =>
    apiClient.get<ReferralClientMaskedApi[]>(`${BASE}/me/clients`),
  getMyPayouts: () => apiClient.get<ReferralPayoutApi[]>(`${BASE}/me/payouts`),
  /** ТЗ §7.3 — 12 точек графика дохода и активных клиентов за 12 месяцев. */
  getIncomeChart: () =>
    apiClient.get<MonthlyPointApi[]>(`${BASE}/me/income-chart`),
  /** ТЗ §7.3 — воронка партнёра за период (`30d` по умолчанию). */
  getFunnel: (period: FunnelPeriodApi = '30d') => {
    const qs = new URLSearchParams({ period }).toString();
    return apiClient.get<FunnelApi | null>(`${BASE}/me/funnel?${qs}`);
  },
  attributeCurrentOrg: () =>
    apiClient.post<{ attributed: boolean; slug: string | null }>(
      `${BASE}/attribute-current-org`,
      {},
    ),
  /** ТЗ §8.3a — трекинг событий промо-полосы. 204 No Content. */
  trackPromoEvent: (body: PromoEventBody) =>
    apiClient.post<void>(`${BASE}/me/promo-event`, body),
  /**
   * B2 — прогресс окупаемости подписки за счёт приведённых клиентов.
   * Используется persistent-баннером `ReferralRewardBanner`.
   */
  getRewardProgress: () =>
    apiClient.get<RewardProgressApi>(`${BASE}/me/reward-progress`),

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
      stats: ReferralStatsExtendedApi;
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
