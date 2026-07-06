export type AdminLlmModelApi = {
  id: string;
  providerId: string;
  providerName: string;
  providerDisplayName: string;
  modelKey: string;
  displayName: string;
  contextWindow: number | null;
  capabilitiesJson: Record<string, unknown> | null;
  category: string | null;
  isActive: boolean;
  isDefault: boolean;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
};

export type AdminLlmModelListApi = { items: AdminLlmModelApi[] };

export type AdminLlmModelDomain = {
  id: string;
  providerId: string;
  providerName: string;
  providerDisplayName: string;
  modelKey: string;
  displayName: string;
  contextWindow: number | null;
  capabilitiesJson: Record<string, unknown> | null;
  category: string | null;
  isActive: boolean;
  isDefault: boolean;
  verifiedAt: Date | null;
  notes: string | null;
  createdAt: Date;
};

export function adminLlmModelFromApi(
  api: AdminLlmModelApi,
): AdminLlmModelDomain {
  return {
    id: api.id,
    providerId: api.providerId,
    providerName: api.providerName,
    providerDisplayName: api.providerDisplayName,
    modelKey: api.modelKey,
    displayName: api.displayName,
    contextWindow: api.contextWindow,
    capabilitiesJson: api.capabilitiesJson,
    category: api.category,
    isActive: api.isActive,
    isDefault: api.isDefault,
    verifiedAt: api.verifiedAt ? new Date(api.verifiedAt) : null,
    notes: api.notes,
    createdAt: new Date(api.createdAt),
  };
}

export type ModelRemovalImpactApi = {
  modelKey: string;
  providerName: string;
  isDefault: boolean;
  affectedRoutesCount: number;
  affectedTenantsCount: number;
  inDefaultChain: boolean;
  currentDefaultModel: string | null;
};

export type CreateLlmModelRequest = {
  providerId: string;
  modelKey: string;
  displayName: string;
  contextWindow?: number;
  capabilities?: Record<string, unknown>;
  category?: "flagship" | "fast" | "reasoning" | "embedding" | "experimental";
  isActive?: boolean;
  notes?: string;
};

export type UpdateLlmModelRequest = Partial<
  Omit<CreateLlmModelRequest, "providerId" | "modelKey">
>;

export type AdminLlmModelPriceHistoryApi = {
  items: Array<{
    id: string;
    provider: string;
    model: string;
    inputCostPerMillionTokens: number;
    outputCostPerMillionTokens: number;
    cachedCostPerMillionTokens: number;
    currency: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
};
