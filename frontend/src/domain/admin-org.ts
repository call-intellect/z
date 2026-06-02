/**
 * Доменная модель Org для Z-Admin (Фаза 7).
 *
 * Контракт: backend `AdminOrgsService.AdminOrgRow`.
 */

export type OrgTier = 'basic' | 'pro' | 'enterprise';

export const ORG_TIER_LABELS: Record<OrgTier, string> = {
  basic: 'Basic',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/** Зеркало backend `SubscriptionStatus` (фронт не импортирует @prisma/client). */
export type SubscriptionStatusUi =
  | 'DEMO'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'EXPIRED';

/** Зеркало backend `PaymentMode`. */
export type PaymentModeUi = 'paid' | 'bonus' | 'reference';

export type AdminOrgRowApi = {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  /** Реальное состояние оплаты (collapse-to-standard). null = нет подписки → «Демо». */
  subscriptionStatus: SubscriptionStatusUi | null;
  paymentMode: PaymentModeUi | null;
  ownerId: string;
  ownerEmail: string | null;
  membersCount: number;
  meetingsCount: number;
  costUsdInPeriod: number;
  callsInPeriod: number;
  deletedAt: string | null;
  createdAt: string;
};

export type AdminOrgListApi = {
  items: AdminOrgRowApi[];
};

export type AdminOrgRowDomain = Omit<
  AdminOrgRowApi,
  'createdAt' | 'deletedAt'
> & {
  createdAt: Date;
  deletedAt: Date | null;
  isFrozen: boolean;
};

export type AdminOrgListDomain = {
  items: AdminOrgRowDomain[];
};

export function adminOrgRowFromApi(api: AdminOrgRowApi): AdminOrgRowDomain {
  return {
    ...api,
    createdAt: new Date(api.createdAt),
    deletedAt: api.deletedAt ? new Date(api.deletedAt) : null,
    isFrozen: api.deletedAt !== null,
  };
}

export function adminOrgListFromApi(
  api: AdminOrgListApi,
): AdminOrgListDomain {
  return { items: api.items.map(adminOrgRowFromApi) };
}

export type UpdateOrgRequest = {
  /** @deprecated после collapse-to-standard не влияет на биллинг; UI не использует. */
  tier?: OrgTier;
  /** true = заморозить (deletedAt=now), false = разморозить. */
  freeze?: boolean;
};

/** Вариант бейджа shadcn для состояния подписки Org. */
export type OrgSubscriptionBadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'secondary';

/**
 * Человекочитаемый статус оплаты Org для списка `/admin/orgs`.
 * Источник — реальное состояние Subscription (не legacy Org.tier).
 */
export function orgSubscriptionLabel(
  status: SubscriptionStatusUi | null,
  paymentMode: PaymentModeUi | null,
): string {
  if (status === null || status === 'DEMO') return 'Демо';
  switch (status) {
    case 'ACTIVE':
      if (paymentMode === 'paid') return 'Платный';
      if (paymentMode === 'bonus') return 'Бонус';
      if (paymentMode === 'reference') return 'Эталон';
      return 'Активна';
    case 'PAST_DUE':
      return 'Просрочена';
    case 'SUSPENDED':
      return 'Заморожена оплата';
    case 'CANCELED':
      return 'Отменена';
    case 'EXPIRED':
      return 'Истекла';
    default:
      return 'Демо';
  }
}

/** Парный цветовой токен через вариант бейджа (никаких hex/slate). */
export function orgSubscriptionBadgeVariant(
  status: SubscriptionStatusUi | null,
  paymentMode: PaymentModeUi | null,
): OrgSubscriptionBadgeVariant {
  if (status === null || status === 'DEMO') return 'secondary';
  switch (status) {
    case 'ACTIVE':
      if (paymentMode === 'paid') return 'success';
      if (paymentMode === 'bonus') return 'warning';
      if (paymentMode === 'reference') return 'secondary';
      return 'default';
    case 'PAST_DUE':
    case 'SUSPENDED':
      return 'danger';
    case 'CANCELED':
    case 'EXPIRED':
      return 'secondary';
    default:
      return 'secondary';
  }
}
