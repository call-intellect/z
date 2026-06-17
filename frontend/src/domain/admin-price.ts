export type AdminPriceApi = {
  id: string;
  provider: string;
  model: string;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cachedCostPerMillionTokens: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};

export type AdminPriceListApi = {
  items: AdminPriceApi[];
};

export type AdminPriceDomain = {
  id: string;
  provider: string;
  model: string;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cachedCostPerMillionTokens: number;
  currency: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  isActive: boolean;
};

export type AdminPriceListDomain = {
  items: AdminPriceDomain[];
};

export function adminPriceFromApi(api: AdminPriceApi): AdminPriceDomain {
  return {
    id: api.id,
    provider: api.provider,
    model: api.model,
    inputCostPerMillionTokens: api.inputCostPerMillionTokens,
    outputCostPerMillionTokens: api.outputCostPerMillionTokens,
    cachedCostPerMillionTokens: api.cachedCostPerMillionTokens,
    currency: api.currency,
    effectiveFrom: new Date(api.effectiveFrom),
    effectiveTo: api.effectiveTo ? new Date(api.effectiveTo) : null,
    createdAt: new Date(api.createdAt),
    isActive: api.effectiveTo === null,
  };
}

export function adminPriceListFromApi(
  api: AdminPriceListApi,
): AdminPriceListDomain {
  return { items: api.items.map(adminPriceFromApi) };
}

export type SetPriceRequest = {
  provider: string;
  model: string;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cachedCostPerMillionTokens?: number;
  currency?: string;
  effectiveFrom?: string;
};
