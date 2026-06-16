import type {
  FunnelApi,
  FunnelPeriodApi,
  MonthlyPointApi,
  ReferralClientMaskedApi,
  ReferralClientStatusApi,
  ReferralLegalFormApi,
  ReferralPayoutApi,
  ReferralPayoutStatusApi,
  ReferralStatsExtendedApi,
  ReferralViewApi,
  RewardProgressApi,
} from "@/api/types/referrals";
import { formatRubles } from "@/domain/billing";

export type ReferralLegalForm = ReferralLegalFormApi;
export type ReferralPayoutStatus = ReferralPayoutStatusApi;
export type ReferralClientStatus = ReferralClientStatusApi;
export type FunnelPeriod = FunnelPeriodApi;

export interface ReferralDomain {
  id: string;
  slug: string;
  hasPayoutDetails: boolean;
  inn: string | null;
  innVerifiedAt: Date | null;
  legalForm: ReferralLegalForm | null;
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

export interface ReferralStatsDomain {
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

export interface ReferralClientMaskedDomain {
  clientCode: string;
  attachedAt: Date;
  firstPaidAt: Date | null;
  status: ReferralClientStatus;
  monthlyEarningsKopecks: number;
  totalEarnedKopecks: number;
}

export interface MonthlyPointDomain {
  month: string;
  incomeRub: number;
  activeClients: number;
}

export interface FunnelDomain {
  period: FunnelPeriod;
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

export interface RewardProgressDomain {
  hasProfile: boolean;
  activePaying: number;
  targetClients: number;
  monthlyEarnedKopecks: number;
}

export function referralFromApi(api: ReferralViewApi): ReferralDomain {
  return {
    id: api.id,
    slug: api.slug,
    hasPayoutDetails: api.hasPayoutDetails,
    inn: api.inn,
    innVerifiedAt: api.innVerifiedAt ? new Date(api.innVerifiedAt) : null,
    legalForm: api.legalForm,
    contractAcceptedAt: api.contractAcceptedAt
      ? new Date(api.contractAcceptedAt)
      : null,
    createdAt: new Date(api.createdAt),
  };
}

export function referralPayoutFromApi(
  api: ReferralPayoutApi,
): ReferralPayoutDomain {
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

export function referralStatsFromApi(
  api: ReferralStatsExtendedApi,
): ReferralStatsDomain {
  return { ...api };
}

export function referralClientMaskedFromApi(
  api: ReferralClientMaskedApi,
): ReferralClientMaskedDomain {
  return {
    clientCode: api.clientCode,
    attachedAt: new Date(api.attachedAt),
    firstPaidAt: api.firstPaidAt ? new Date(api.firstPaidAt) : null,
    status: api.status,
    monthlyEarningsKopecks: api.monthlyEarningsKopecks,
    totalEarnedKopecks: api.totalEarnedKopecks,
  };
}

export function monthlyPointFromApi(api: MonthlyPointApi): MonthlyPointDomain {
  return {
    month: api.month,
    incomeRub: api.incomeRub,
    activeClients: api.activeClients,
  };
}

export function funnelFromApi(api: FunnelApi): FunnelDomain {
  return {
    period: api.period,
    clicks: api.clicks,
    signups: api.signups,
    firstPayments: api.firstPayments,
    activeNow: api.activeNow,
    conversions: {
      clickToSignupPercent: api.conversions.clickToSignupPercent,
      signupToPaidPercent: api.conversions.signupToPaidPercent,
      clickToPaidPercent: api.conversions.clickToPaidPercent,
    },
  };
}

export function rewardProgressFromApi(
  api: RewardProgressApi,
): RewardProgressDomain {
  return {
    hasProfile: api.hasProfile,
    activePaying: api.activePaying,
    targetClients: api.targetClients,
    monthlyEarnedKopecks: api.monthlyEarnedKopecks,
  };
}

export function legalFormLabel(f: ReferralLegalForm | null): string {
  if (!f) return "Не указана";
  const map: Record<ReferralLegalForm, string> = {
    self_employed: "Самозанятый (НПД)",
    individual_entrepreneur: "ИП",
    legal_entity: "Юридическое лицо",
  };
  return map[f];
}

export function payoutStatusLabel(s: ReferralPayoutStatus): string {
  const map: Record<ReferralPayoutStatus, string> = {
    pending: "Ожидает",
    paid: "Выплачено",
    void: "Отменено",
  };
  return map[s];
}

export function payoutStatusColor(
  s: ReferralPayoutStatus,
): "green" | "amber" | "red" {
  if (s === "paid") return "green";
  if (s === "pending") return "amber";
  return "red";
}

export function clientStatusLabel(s: ReferralClientStatus): string {
  const map: Record<ReferralClientStatus, string> = {
    active: "Активен",
    churned: "Ушёл",
    pending: "Не оплатил",
  };
  return map[s];
}

export function buildReferralUrl(slug: string, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/?ref=${encodeURIComponent(slug)}`;
}

export function isFullyVerified(ref: ReferralDomain): boolean {
  return ref.innVerifiedAt !== null && ref.contractAcceptedAt !== null;
}

export function payoutDetailsAreFilled(ref: ReferralDomain): boolean {
  return ref.hasPayoutDetails;
}

export function canWithdraw(
  ref: ReferralDomain,
  totalPendingKopecks: number,
): boolean {
  return (
    isFullyVerified(ref) &&
    payoutDetailsAreFilled(ref) &&
    totalPendingKopecks > 0
  );
}

export function withdrawBlockReason(
  ref: ReferralDomain,
  totalPendingKopecks: number,
): string | null {
  if (!payoutDetailsAreFilled(ref)) {
    return "Заполни реквизиты для вывода";
  }
  if (ref.innVerifiedAt === null) {
    return "Проверь ИНН в разделе «Реквизиты»";
  }
  if (totalPendingKopecks <= 0) {
    return "Пока нечего выводить";
  }
  return null;
}

export interface FunnelRow {
  key: "clicks" | "signups" | "firstPayments" | "activeNow";
  label: string;
  value: number;
  conversionPercent: number | null;
}

export function funnelConversion(funnel: FunnelDomain): FunnelRow[] {
  const safePct = (numerator: number, denominator: number): number | null => {
    if (denominator <= 0) return null;
    return Math.round((numerator / denominator) * 1000) / 10;
  };
  return [
    {
      key: "clicks",
      label: "Кликов",
      value: funnel.clicks,
      conversionPercent: null,
    },
    {
      key: "signups",
      label: "Регистраций",
      value: funnel.signups,
      conversionPercent: safePct(funnel.signups, funnel.clicks),
    },
    {
      key: "firstPayments",
      label: "Первых оплат",
      value: funnel.firstPayments,
      conversionPercent: safePct(funnel.firstPayments, funnel.signups),
    },
    {
      key: "activeNow",
      label: "Активных сейчас",
      value: funnel.activeNow,
      conversionPercent: safePct(funnel.activeNow, funnel.firstPayments),
    },
  ];
}

export function funnelPeriodLabel(p: FunnelPeriod): string {
  const map: Record<FunnelPeriod, string> = {
    "30d": "За 30 дней",
    "90d": "За 90 дней",
    all: "За всё время",
  };
  return map[p];
}

export const REFERRAL_REWARD_PER_CLIENT_KOPECKS = 20_000_00;

export type ReferralBannerVariant =
  | "leaderNoProfile"
  | "leaderInProgress"
  | "leaderReached"
  | "member";

export interface ReferralBannerCopy {
  variant: ReferralBannerVariant;
  title: string;
  subtitle: string;
  cta: string;
  showProgress: boolean;
}

export function referralBannerCopy(
  isLeader: boolean,
  progress: RewardProgressDomain,
): ReferralBannerCopy {
  const { hasProfile, activePaying, targetClients } = progress;

  if (!isLeader) {
    return {
      variant: "member",
      title: "Дополнительный заработок с Корой",
      subtitle:
        "Сделай партнёрскую ссылку и отправь знакомым руководителям — 20 000 ₽/мес с каждой компании.",
      cta: "Создать ссылку",
      showProgress: false,
    };
  }

  if (!hasProfile) {
    return {
      variant: "leaderNoProfile",
      title: `Пользуйся Корой бесплатно — приведи ${targetClients} компании`,
      subtitle: `Каждая платит 20 000 ₽/мес — подписка окупится. Осталось привести: ${targetClients} из ${targetClients}.`,
      cta: "Создать ссылку",
      showProgress: true,
    };
  }

  if (activePaying < targetClients) {
    const left = targetClients - activePaying;
    return {
      variant: "leaderInProgress",
      title: "Окупаем подписку приведёнными компаниями",
      subtitle: `Осталось привести ещё ${left} из ${targetClients} — подписка окупится.`,
      cta: "Моя ссылка",
      showProgress: true,
    };
  }

  return {
    variant: "leaderReached",
    title: "Подписка окуплена 🎉 дальше — чистый заработок",
    subtitle: "Каждая новая компания приносит 20 000 ₽/мес сверху.",
    cta: "Мой кабинет партнёра",
    showProgress: false,
  };
}

export function referralMonthlyEarnedLabel(kopecks: number): string | null {
  if (kopecks <= 0) return null;
  return `${formatRubles(kopecks)}/мес`;
}

export function monthLabel(yyyymm: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!match) return yyyymm;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const monthsShort = [
    "янв",
    "фев",
    "мар",
    "апр",
    "май",
    "июн",
    "июл",
    "авг",
    "сен",
    "окт",
    "ноя",
    "дек",
  ];
  const m = monthsShort[month] ?? "";
  return `${m} ${String(year).slice(-2)}`;
}
