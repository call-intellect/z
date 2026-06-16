export type ReferralLegalFormApi =
  | "self_employed"
  | "individual_entrepreneur"
  | "legal_entity";

export type ReferralPayoutStatusApi = "pending" | "paid" | "void";

export type ReferralClientStatusApi = "active" | "churned" | "pending";

export type FunnelPeriodApi = "30d" | "90d" | "all";

export type ReferralPromoRoleApi = "owner" | "member";

export type ReferralPromoEventTypeApi = "impression" | "click" | "dismissed";

export interface ReferralViewApi {
  id: string;
  slug: string;
  hasPayoutDetails: boolean;
  inn: string | null;
  innVerifiedAt: string | null;
  legalForm: ReferralLegalFormApi | null;
  contractAcceptedAt: string | null;
  createdAt: string;
}

export interface ReferralStatsExtendedApi {
  totalClients: number;
  activePaying: number;
  totalEarnedKopecks: number;
  totalPaidKopecks: number;
  totalPendingKopecks: number;
  clicks30d: number;
  signups30d: number;
  firstPayments30d: number;
  conversionClickToPaidPercent: number;
  conversionSignupToPaidPercent: number;
}

export type ReferralStatsApi = ReferralStatsExtendedApi;

export interface CreateReferralBody {
  contractAccepted: true;
  inn?: string;
  legalForm?: ReferralLegalFormApi;
  payoutDetails?: Record<string, unknown>;
}

export interface UpdateReferralBody {
  inn?: string;
  legalForm?: ReferralLegalFormApi;
  payoutDetails?: Record<string, unknown>;
}

export interface ReferralPayoutApi {
  id: string;
  referralId: string;
  clientReferralLinkId: string;
  triggerInvoiceId: string | null;
  periodMonth: string;
  amountKopecks: number;
  status: ReferralPayoutStatusApi;
  payoutDocumentUrl: string | null;
  paidAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface ReferralClientMaskedApi {
  clientCode: string;
  attachedAt: string;
  firstPaidAt: string | null;
  status: ReferralClientStatusApi;
  monthlyEarningsKopecks: number;
  totalEarnedKopecks: number;
}

export interface ReferralClientApi {
  id: string;
  tenantId: string;
  referralId: string;
  attachedAt: string;
  firstPaidAt: string | null;
  org: { id: string; name: string };
  subscription: {
    status: string;
    paymentMode: string | null;
    currentPeriodEnd: string | null;
    totalPaidKopecks: number;
  } | null;
}

export interface MonthlyPointApi {
  month: string;
  incomeRub: number;
  activeClients: number;
}

export interface FunnelApi {
  period: FunnelPeriodApi;
  clicks: number;
  signups: number;
  firstPayments: number;
  activeNow: number;
  conversions: {
    clickToSignupPercent: number;
    signupToPaidPercent: number;
    clickToPaidPercent: number;
  };
}

export interface PromoEventBody {
  type: ReferralPromoEventTypeApi;
  role: ReferralPromoRoleApi;
}

export interface RewardProgressApi {
  hasProfile: boolean;
  activePaying: number;
  targetClients: number;
  monthlyEarnedKopecks: number;
}
