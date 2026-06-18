export type FeatureFlagApiDto = {
  key: string;
  description: string;
  category: string;
  defaultValue: boolean;
  orgOverrides: Record<string, boolean>;
  rolloutPercent: number | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type FeatureFlagListApiDto = {
  items: FeatureFlagApiDto[];
};

export type FeatureFlagResolveApiDto = {
  key: string;
  tenantId: string | null;
  resolved: boolean;
  source: "override" | "rollout" | "default";
};

export type FeatureFlagDomain = Omit<FeatureFlagApiDto, "updatedAt"> & {
  updatedAt: Date;
  orgOverridesCount: number;
};

export type FeatureFlagListDomain = {
  items: FeatureFlagDomain[];
};

export function featureFlagFromApi(api: FeatureFlagApiDto): FeatureFlagDomain {
  return {
    ...api,
    updatedAt: new Date(api.updatedAt),
    orgOverridesCount: Object.keys(api.orgOverrides ?? {}).length,
  };
}

export function featureFlagListFromApi(
  api: FeatureFlagListApiDto,
): FeatureFlagListDomain {
  return { items: api.items.map(featureFlagFromApi) };
}

export type UpsertFeatureFlagRequest = {
  key: string;
  description: string;
  category: string;
  defaultValue: boolean;
  orgOverrides?: Record<string, boolean>;
  rolloutPercent?: number | null;
  reason?: string;
};

export type UpdateFeatureFlagRequest = Partial<
  Omit<UpsertFeatureFlagRequest, "key">
>;

export const FEATURE_FLAG_CATEGORIES: Array<{ value: string; label: string }> =
  [
    { value: "ai", label: "AI" },
    { value: "ui", label: "UI" },
    { value: "experimental", label: "Эксперимент" },
    { value: "integration", label: "Интеграция" },
    { value: "safety", label: "Безопасность" },
  ];
