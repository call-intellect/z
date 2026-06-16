/**
 * API DTO для модуля referrals.
 * Источник правды — backend/src/modules/referrals/dto/referrals.dto.ts.
 *
 * Обновлено по ТЗ 2026-05-31-referrals-cabinet-revamp:
 *   - `Referral.inn / legalForm` → nullable (§5.1).
 *   - `CreateReferralBody` — обязательный `contractAccepted`, остальное опционально (§7.6).
 *   - Расширенная статистика 30d, маскированные клиенты, income-chart, funnel (§7.3–7.4).
 *   - Промо-событие для трекинга баннера партнёрской программы (§8.3a).
 */

export type ReferralLegalFormApi =
  | 'self_employed'
  | 'individual_entrepreneur'
  | 'legal_entity';

export type ReferralPayoutStatusApi = 'pending' | 'paid' | 'void';

export type ReferralClientStatusApi = 'active' | 'churned' | 'pending';

export type FunnelPeriodApi = '30d' | '90d' | 'all';

export type ReferralPromoRoleApi = 'owner' | 'member';

export type ReferralPromoEventTypeApi = 'impression' | 'click' | 'dismissed';

export interface ReferralViewApi {
  id: string;
  slug: string;
  /**
   * Computed-поле (ТЗ §6.3 + §6.5): `payoutDetails != null && Object.keys > 0`.
   *
   * Фронт строит по нему `payoutDetailsAreFilled` → `canWithdraw`. До
   * 2026-05-31 фронт смотрел на прокси `inn && legalForm` — это включало
   * кнопку «Вывести» при заполненном ИНН без банковских реквизитов,
   * после чего backend возвращал 400.
   */
  hasPayoutDetails: boolean;
  /** ТЗ §5.1: nullable — можно создать профиль без ИНН. */
  inn: string | null;
  innVerifiedAt: string | null;
  /** ТЗ §5.1: nullable — можно создать профиль без формы. */
  legalForm: ReferralLegalFormApi | null;
  contractAcceptedAt: string | null;
  createdAt: string;
}

/**
 * Расширенная статистика партнёра (ТЗ §7.2 + §7.4).
 *
 * Старые 5 полей сохранены для обратной совместимости + 5 новых
 * (клики/регистрации/первые оплаты/конверсии за 30 дней).
 */
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

/** Legacy alias — старое имя для уже существующего кода. */
export type ReferralStatsApi = ReferralStatsExtendedApi;

/**
 * Тело `POST /api/v1/referrals/me` (ТЗ §7.6).
 *
 * - `contractAccepted` — обязателен (Zod literal(true) на backend).
 * - `inn / legalForm / payoutDetails` — опциональны, заполняются позже.
 * - Если задан `inn` — обязателен `legalForm` (валидация в сервисе).
 */
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

/**
 * Маскированный приведённый клиент (ТЗ §6.4 + §7.4).
 *
 * Никаких полей, идентифицирующих Org: ни `org.name`, ни `org.id`,
 * ни `tenantId`. `clientCode` — детерминированный анонимный идентификатор
 * `'C' + base36(crc32(ClientReferralLink.id))`, длина ~7 символов.
 */
export interface ReferralClientMaskedApi {
  clientCode: string;
  attachedAt: string;
  firstPaidAt: string | null;
  status: ReferralClientStatusApi;
  monthlyEarningsKopecks: number;
  totalEarnedKopecks: number;
}

/** Legacy alias — используется в админских эндпоинтах, где маскировка не нужна. */
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

/** Точка графика дохода (ТЗ §7.3). 12 точек за последние 12 месяцев (UTC). */
export interface MonthlyPointApi {
  /** YYYY-MM. */
  month: string;
  incomeRub: number;
  activeClients: number;
}

/** Воронка партнёра за период (ТЗ §7.3). */
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

/** Тело трекинга промо-полосы (ТЗ §8.3a). 204 No Content. */
export interface PromoEventBody {
  type: ReferralPromoEventTypeApi;
  role: ReferralPromoRoleApi;
}

/**
 * Прогресс окупаемости подписки за счёт приведённых клиентов (B2).
 *
 * `GET /api/v1/referrals/me/reward-progress`.
 *
 *   - `hasProfile` — есть ли у пользователя Referral-профиль.
 *     Pre-profile → `{ hasProfile: false, activePaying: 0, targetClients: 3,
 *     monthlyEarnedKopecks: 0 }`.
 *   - `activePaying` — сколько приведённых компаний платят сейчас.
 *   - `targetClients` — сколько нужно для окупаемости (дефолт 3).
 *   - `monthlyEarnedKopecks` — текущий ежемесячный заработок партнёра.
 */
export interface RewardProgressApi {
  hasProfile: boolean;
  activePaying: number;
  targetClients: number;
  monthlyEarnedKopecks: number;
}
