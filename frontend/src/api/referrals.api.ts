import { apiClient } from "./api-client";
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
} from "./types/referrals";

const BASE = "/api/v1/referrals";
const ADMIN = "/api/v1/admin/referrals";

export const referralsApi = {
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
  getIncomeChart: () =>
    apiClient.get<MonthlyPointApi[]>(`${BASE}/me/income-chart`),
  getFunnel: (period: FunnelPeriodApi = "30d") => {
    const qs = new URLSearchParams({ period }).toString();
    return apiClient.get<FunnelApi | null>(`${BASE}/me/funnel?${qs}`);
  },
  attributeCurrentOrg: () =>
    apiClient.post<{ attributed: boolean; slug: string | null }>(
      `${BASE}/attribute-current-org`,
      {},
    ),
  trackPromoEvent: (body: PromoEventBody) =>
    apiClient.post<void>(`${BASE}/me/promo-event`, body),
  getRewardProgress: () =>
    apiClient.get<RewardProgressApi>(`${BASE}/me/reward-progress`),

  adminListReferrals: (params?: { limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    const qs = search.toString();
    return apiClient.get<{
      items: Array<
        ReferralViewApi & {
          owner: { id: string; email: string; name: string };
        }
      >;
    }>(`${ADMIN}${qs ? `?${qs}` : ""}`);
  },
  adminGetReferral: (id: string) =>
    apiClient.get<{
      referral: ReferralViewApi;
      clients: ReferralClientApi[];
      payouts: ReferralPayoutApi[];
      stats: ReferralStatsExtendedApi;
    }>(`${ADMIN}/${id}`),
  adminListPayouts: (params?: {
    status?: "pending" | "paid" | "void";
    periodMonth?: string;
    limit?: number;
    offset?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    if (params?.periodMonth) search.set("periodMonth", params.periodMonth);
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    const qs = search.toString();
    return apiClient.get<{ items: ReferralPayoutApi[]; total: number }>(
      `${ADMIN}/payouts${qs ? `?${qs}` : ""}`,
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
