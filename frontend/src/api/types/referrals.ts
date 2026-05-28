/**
 * API DTO для модуля referrals.
 * Источник правды — backend/src/modules/referrals/.
 */

export type ReferralLegalFormApi =
  | 'self_employed'
  | 'individual_entrepreneur'
  | 'legal_entity';

export type ReferralPayoutStatusApi = 'pending' | 'paid' | 'void';

export interface ReferralViewApi {
  id: string;
  slug: string;
  inn: string;
  innVerifiedAt: string | null;
  legalForm: ReferralLegalFormApi;
  contractAcceptedAt: string | null;
  createdAt: string;
}

export interface ReferralStatsApi {
  totalClients: number;
  activePaying: number;
  totalEarnedKopecks: number;
  totalPaidKopecks: number;
  totalPendingKopecks: number;
}

export interface CreateReferralBody {
  inn: string;
  legalForm: ReferralLegalFormApi;
  payoutDetails: Record<string, unknown>;
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
