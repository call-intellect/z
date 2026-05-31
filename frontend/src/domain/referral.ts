/**
 * Domain-модель партнёрской программы.
 *
 * Обновлено по ТЗ 2026-05-31-referrals-cabinet-revamp:
 *   - `Referral.inn / legalForm` теперь nullable (§5.1).
 *   - Маппер `referralClientMaskedFromApi` — анонимный клиент (§6.4).
 *   - `monthlyPointFromApi`, `funnelFromApi` — новые DTO под графики и воронку.
 *   - `funnelConversion(funnel)` — утилита процентов для UI.
 *   - `payoutDetailsAreFilled(referral)` — для логики «можно ли вывести».
 *
 * Терминология (§9.1): «партнёр», «партнёрская ссылка», «оплата клиента» —
 * везде русские термины, английских слов в копи нет.
 */

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
} from '@/api/types/referrals';

// ────────────────────────── Types ──────────────────────────

export type ReferralLegalForm = ReferralLegalFormApi;
export type ReferralPayoutStatus = ReferralPayoutStatusApi;
export type ReferralClientStatus = ReferralClientStatusApi;
export type FunnelPeriod = FunnelPeriodApi;

export interface ReferralDomain {
  id: string;
  slug: string;
  /**
   * Computed-поле (ТЗ §6.3 + §6.5): backend сообщает, заполнен ли
   * `payoutDetails` непустым JSON-объектом. См. `payoutDetailsAreFilled`.
   */
  hasPayoutDetails: boolean;
  /** ТЗ §5.1: nullable. */
  inn: string | null;
  innVerifiedAt: Date | null;
  /** ТЗ §5.1: nullable. */
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
  /** YYYY-MM. */
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

// ────────────────────────── Mappers ──────────────────────────

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

// ────────────────────────── Labels ──────────────────────────

export function legalFormLabel(f: ReferralLegalForm | null): string {
  if (!f) return 'Не указана';
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

export function clientStatusLabel(s: ReferralClientStatus): string {
  const map: Record<ReferralClientStatus, string> = {
    active: 'Активен',
    churned: 'Ушёл',
    pending: 'Не оплатил',
  };
  return map[s];
}

// ────────────────────────── Utils ──────────────────────────

/**
 * Партнёрская ссылка для копирования / QR-кода.
 * `https://app.kora.app/?ref=<slug>` (в проде) или `<origin>/?ref=<slug>` (dev).
 */
export function buildReferralUrl(slug: string, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/?ref=${encodeURIComponent(slug)}`;
}

/**
 * Партнёр «верифицирован полностью» — оба условия выполнены, можно
 * получать выплаты по cron'у 10-го числа.
 *
 * Дополнительно для фактической выплаты нужны `payoutDetails` —
 * см. `payoutDetailsAreFilled` ниже и ТЗ §6.3.
 */
export function isFullyVerified(ref: ReferralDomain): boolean {
  return ref.innVerifiedAt !== null && ref.contractAcceptedAt !== null;
}

/**
 * Заполнены ли реквизиты для вывода (ТЗ §6.3 + §6.5).
 *
 * Backend возвращает `hasPayoutDetails` как computed boolean
 * (`payoutDetails != null && Object.keys > 0`). Это точный признак того,
 * что в `Referral.payoutDetails` лежит непустой объект (т.е. ввели
 * банковские реквизиты, а не только ИНН).
 *
 * До 2026-05-31 здесь была эвристика по `inn && legalForm` — она ложно
 * включала кнопку «Вывести», когда пользователь ввёл ИНН без реквизитов,
 * после чего backend возвращал 400. Перешли на честный признак.
 */
export function payoutDetailsAreFilled(ref: ReferralDomain): boolean {
  return ref.hasPayoutDetails;
}

/**
 * Готов ли партнёр к выводу денег (ТЗ §6.5).
 * Активна кнопка «Вывести» только если все условия выполнены и баланс > 0.
 */
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

/**
 * Причина, по которой кнопка «Вывести» серая (ТЗ §6.5).
 * Возвращает первую нерешённую причину или `null` если всё ок.
 */
export function withdrawBlockReason(
  ref: ReferralDomain,
  totalPendingKopecks: number,
): string | null {
  if (!payoutDetailsAreFilled(ref)) {
    return 'Заполни реквизиты для вывода';
  }
  if (ref.innVerifiedAt === null) {
    return 'Проверь ИНН в разделе «Реквизиты»';
  }
  if (totalPendingKopecks <= 0) {
    return 'Пока нечего выводить';
  }
  return null;
}

/**
 * Полезное представление воронки для UI (ТЗ §8.1 состояние C).
 *
 * Возвращает 4 строки с цифрами и процентом конверсии от предыдущего
 * шага. Конверсия первой строки — `null` (нет «предыдущего»).
 */
export interface FunnelRow {
  key: 'clicks' | 'signups' | 'firstPayments' | 'activeNow';
  label: string;
  value: number;
  /** Процент от предыдущей строки. `null` для первой строки и при делении на 0. */
  conversionPercent: number | null;
}

export function funnelConversion(funnel: FunnelDomain): FunnelRow[] {
  const safePct = (numerator: number, denominator: number): number | null => {
    if (denominator <= 0) return null;
    return Math.round((numerator / denominator) * 1000) / 10;
  };
  return [
    {
      key: 'clicks',
      label: 'Кликов',
      value: funnel.clicks,
      conversionPercent: null,
    },
    {
      key: 'signups',
      label: 'Регистраций',
      value: funnel.signups,
      conversionPercent: safePct(funnel.signups, funnel.clicks),
    },
    {
      key: 'firstPayments',
      label: 'Первых оплат',
      value: funnel.firstPayments,
      conversionPercent: safePct(funnel.firstPayments, funnel.signups),
    },
    {
      key: 'activeNow',
      label: 'Активных сейчас',
      value: funnel.activeNow,
      conversionPercent: safePct(funnel.activeNow, funnel.firstPayments),
    },
  ];
}

/**
 * Лейбл периода для UI селектора.
 */
export function funnelPeriodLabel(p: FunnelPeriod): string {
  const map: Record<FunnelPeriod, string> = {
    '30d': 'За 30 дней',
    '90d': 'За 90 дней',
    all: 'За всё время',
  };
  return map[p];
}

/**
 * Форматирует `YYYY-MM` в короткую русскую метку: `2026-05` → `май 26`.
 * Используется в IncomeChart (XAxis tickFormatter).
 */
export function monthLabel(yyyymm: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!match) return yyyymm;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const monthsShort = [
    'янв',
    'фев',
    'мар',
    'апр',
    'май',
    'июн',
    'июл',
    'авг',
    'сен',
    'окт',
    'ноя',
    'дек',
  ];
  const m = monthsShort[month] ?? '';
  return `${m} ${String(year).slice(-2)}`;
}
