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

export type AdminOrgRowApi = {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
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
  tier?: OrgTier;
  /** true = заморозить (deletedAt=now), false = разморозить. */
  freeze?: boolean;
};
