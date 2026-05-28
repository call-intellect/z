/**
 * Domain-модель реферальной программы.
 */

import type {
  ReferralLegalFormApi,
  ReferralPayoutApi,
  ReferralPayoutStatusApi,
  ReferralStatsApi,
  ReferralViewApi,
} from '@/api/types/referrals';

export type ReferralLegalForm = ReferralLegalFormApi;
export type ReferralPayoutStatus = ReferralPayoutStatusApi;

export interface ReferralDomain {
  id: string;
  slug: string;
  inn: string;
  innVerifiedAt: Date | null;
  legalForm: ReferralLegalForm;
  contractAcceptedAt: Date | null;
  createdAt: Date;
}

export interface ReferralPayoutDomain {
  id: string;
  periodMonth: string;
  amountKopecks: number;
  status: ReferralPayoutStatus;
  payoutDocumentUrl: string | null;
  paidAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

export function referralFromApi(api: ReferralViewApi): ReferralDomain {
  return {
    id: api.id,
    slug: api.slug,
    inn: api.inn,
    innVerifiedAt: api.innVerifiedAt ? new Date(api.innVerifiedAt) : null,
    legalForm: api.legalForm,
    contractAcceptedAt: api.contractAcceptedAt
      ? new Date(api.contractAcceptedAt)
      : null,
    createdAt: new Date(api.createdAt),
  };
}

export function referralPayoutFromApi(api: ReferralPayoutApi): ReferralPayoutDomain {
  return {
    id: api.id,
    periodMonth: api.periodMonth,
    amountKopecks: api.amountKopecks,
    status: api.status,
    payoutDocumentUrl: api.payoutDocumentUrl,
    paidAt: api.paidAt ? new Date(api.paidAt) : null,
    voidReason: api.voidReason,
    createdAt: new Date(api.createdAt),
  };
}

export function referralStatsFromApi(api: ReferralStatsApi): ReferralStatsApi {
  return { ...api };
}

export function legalFormLabel(f: ReferralLegalForm): string {
  const map: Record<ReferralLegalForm, string> = {
    self_employed: 'Самозанятый (НПД)',
    individual_entrepreneur: 'ИП',
    legal_entity: 'Юридическое лицо',
  };
  return map[f];
}

export function payoutStatusLabel(s: ReferralPayoutStatus): string {
  const map: Record<ReferralPayoutStatus, string> = {
    pending: 'Ожидает',
    paid: 'Выплачено',
    void: 'Отменено',
  };
  return map[s];
}

export function payoutStatusColor(
  s: ReferralPayoutStatus,
): 'green' | 'amber' | 'red' {
  if (s === 'paid') return 'green';
  if (s === 'pending') return 'amber';
  return 'red';
}

/**
 * Реферальная ссылка для копирования / QR.
 * Используется на странице кабинета: `https://app.kora.app/?ref=<slug>`.
 */
export function buildReferralUrl(slug: string, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/?ref=${encodeURIComponent(slug)}`;
}

/**
 * Реферал «верифицирован полностью» — оба условия выполнены, можно получать
 * payout'ы по cron'у 10-го числа.
 */
export function isFullyVerified(ref: ReferralDomain): boolean {
  return ref.innVerifiedAt !== null && ref.contractAcceptedAt !== null;
}
