export type EmbeddingProtocolKind = "openai-embeddings" | "ollama-embeddings";

export type AdminEmbeddingModelApi = {
  id: string;
  modelKey: string;
  displayName: string;
  dimensions: number;
  pricePerMillionInputTokensKopecks: number | null;
  isActive: boolean;
  verifiedAt: string | null;
  notes: string | null;
};

export type AdminEmbeddingProviderApi = {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: string;
  hasApiKey: boolean;
  defaultHeaders: Record<string, string> | null;
  isActive: boolean;
  priority: number;
  needsReindex: boolean;
  lastSmokeAt: string | null;
  lastSmokeSuccess: boolean | null;
  lastSmokeError: string | null;
  createdAt: string;
  updatedAt: string;
  models: AdminEmbeddingModelApi[];
};

export type AdminEmbeddingProviderListApi = {
  items: AdminEmbeddingProviderApi[];
};

export type AdminEmbeddingModelDomain = {
  id: string;
  modelKey: string;
  displayName: string;
  dimensions: number;
  pricePerMillionInputTokensKopecks: number | null;
  isActive: boolean;
  verifiedAt: Date | null;
  notes: string | null;
};

export type AdminEmbeddingProviderDomain = {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: string;
  hasApiKey: boolean;
  defaultHeaders: Record<string, string> | null;
  isActive: boolean;
  priority: number;
  needsReindex: boolean;
  lastSmokeAt: Date | null;
  lastSmokeSuccess: boolean | null;
  lastSmokeError: string | null;
  createdAt: Date;
  updatedAt: Date;
  models: AdminEmbeddingModelDomain[];
};

export function adminEmbeddingModelFromApi(
  api: AdminEmbeddingModelApi,
): AdminEmbeddingModelDomain {
  return {
    id: api.id,
    modelKey: api.modelKey,
    displayName: api.displayName,
    dimensions: api.dimensions,
    pricePerMillionInputTokensKopecks: api.pricePerMillionInputTokensKopecks,
    isActive: api.isActive,
    verifiedAt: api.verifiedAt ? new Date(api.verifiedAt) : null,
    notes: api.notes,
  };
}

export function adminEmbeddingProviderFromApi(
  api: AdminEmbeddingProviderApi,
): AdminEmbeddingProviderDomain {
  return {
    id: api.id,
    name: api.name,
    displayName: api.displayName,
    baseUrl: api.baseUrl,
    protocolKind: api.protocolKind,
    hasApiKey: api.hasApiKey,
    defaultHeaders: api.defaultHeaders,
    isActive: api.isActive,
    priority: api.priority,
    needsReindex: api.needsReindex,
    lastSmokeAt: api.lastSmokeAt ? new Date(api.lastSmokeAt) : null,
    lastSmokeSuccess: api.lastSmokeSuccess,
    lastSmokeError: api.lastSmokeError,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    models: api.models.map(adminEmbeddingModelFromApi),
  };
}

export type CreateEmbeddingModelRequest = {
  modelKey: string;
  displayName: string;
  dimensions: number;
  pricePerMillionInputTokensKopecks?: number | null;
  isActive?: boolean;
  notes?: string | null;
};

export type UpdateEmbeddingModelRequest = Partial<
  Omit<CreateEmbeddingModelRequest, "modelKey">
>;

export type CreateEmbeddingProviderRequest = {
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: EmbeddingProtocolKind;
  apiKey?: string | null;
  defaultHeaders?: Record<string, string> | null;
  isActive?: boolean;
  priority?: number;
  models?: CreateEmbeddingModelRequest[];
};

export type UpdateEmbeddingProviderRequest = Partial<
  Omit<CreateEmbeddingProviderRequest, "name" | "models">
>;

export type EmbeddingSmokeResultApi = {
  ok: boolean;
  error?: string;
};
