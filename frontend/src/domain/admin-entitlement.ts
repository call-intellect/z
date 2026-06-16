export type EntitlementOverviewItemApi = {
  tenantId: string;
  orgName: string;
  orgSlug: string;
  tier: string;
  featureOverridesKeys: number;
  quotaOverridesKeys: number;
  notes: string | null;
  updatedAt: string;
};

export type EntitlementOverviewApi = {
  items: EntitlementOverviewItemApi[];
  nextCursor: string | null;
};

export type ResolvedEntitlementsApi = {
  tenantId: string;
  tier: string;
  plan: {
    id: string;
    displayName: string;
    isActive: boolean;
    features: Record<string, unknown>;
    quotas: Record<string, unknown>;
  } | null;
  features: Record<string, unknown>;
  quotas: Record<string, unknown>;
  featureOverrides: Record<string, unknown>;
  quotaOverrides: Record<string, unknown>;
  notes: string | null;
};

export type EntitlementOverviewItemDomain = Omit<
  EntitlementOverviewItemApi,
  "updatedAt"
> & {
  updatedAt: Date;
};

export type EntitlementOverviewDomain = {
  items: EntitlementOverviewItemDomain[];
  nextCursor: string | null;
};

export function entitlementOverviewItemFromApi(
  api: EntitlementOverviewItemApi,
): EntitlementOverviewItemDomain {
  return {
    ...api,
    updatedAt: new Date(api.updatedAt),
  };
}

export function entitlementOverviewFromApi(
  api: EntitlementOverviewApi,
): EntitlementOverviewDomain {
  return {
    items: api.items.map(entitlementOverviewItemFromApi),
    nextCursor: api.nextCursor,
  };
}

export type UpsertEntitlementRequest = {
  tier?: string;
  featureOverrides?: Record<string, boolean | number | string | null> | null;
  quotaOverrides?: Record<string, boolean | number | string | null> | null;
  notes?: string | null;
};
