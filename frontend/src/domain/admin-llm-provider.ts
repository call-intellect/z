export type AdminLlmProviderApi = {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: string;
  capability: string;
  isActive: boolean;
  useProxy: boolean;
  proxyPath: string | null;
  timeoutMs: number | null;
  defaultModelKey: string | null;
  hasApiKey: boolean;
  defaultHeaders: Record<string, string> | null;
  globalRps: number | null;
  isDefaultProvider: boolean;
  billingMode: string;
  subscriptionMonthlyCostUsd: number | null;
  subscriptionStartedAt: string | null;
  lastSmokeAt: string | null;
  lastSmokeSuccess: boolean | null;
  lastSmokeError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLlmProviderListApi = { items: AdminLlmProviderApi[] };

export type AdminLlmProviderDomain = {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: string;
  capability: string;
  isActive: boolean;
  useProxy: boolean;
  proxyPath: string | null;
  timeoutMs: number | null;
  defaultModelKey: string | null;
  hasApiKey: boolean;
  defaultHeaders: Record<string, string> | null;
  globalRps: number | null;
  isDefaultProvider: boolean;
  billingMode: string;
  subscriptionMonthlyCostUsd: number | null;
  subscriptionStartedAt: Date | null;
  lastSmokeAt: Date | null;
  lastSmokeSuccess: boolean | null;
  lastSmokeError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function adminLlmProviderFromApi(
  api: AdminLlmProviderApi,
): AdminLlmProviderDomain {
  return {
    id: api.id,
    name: api.name,
    displayName: api.displayName,
    baseUrl: api.baseUrl,
    protocolKind: api.protocolKind,
    capability: api.capability,
    isActive: api.isActive,
    useProxy: api.useProxy,
    proxyPath: api.proxyPath,
    timeoutMs: api.timeoutMs,
    defaultModelKey: api.defaultModelKey,
    hasApiKey: api.hasApiKey,
    defaultHeaders: api.defaultHeaders,
    globalRps: api.globalRps,
    isDefaultProvider: api.isDefaultProvider,
    billingMode: api.billingMode,
    subscriptionMonthlyCostUsd: api.subscriptionMonthlyCostUsd,
    subscriptionStartedAt: api.subscriptionStartedAt
      ? new Date(api.subscriptionStartedAt)
      : null,
    lastSmokeAt: api.lastSmokeAt ? new Date(api.lastSmokeAt) : null,
    lastSmokeSuccess: api.lastSmokeSuccess,
    lastSmokeError: api.lastSmokeError,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export type LlmProtocolKind =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "ollama-native"
  | "kie-native"
  | "grsai-native"
  | "custom-http";

export type LlmProviderCapability =
  | "public"
  | "internal"
  | "sensitive"
  | "private";

export type CreateLlmProviderRequest = {
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: LlmProtocolKind;
  capability?: LlmProviderCapability;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  globalRps?: number;
  isActive?: boolean;
  useProxy?: boolean;
  proxyPath?: string | null;
  timeoutMs?: number | null;
  defaultModelKey?: string | null;
  billingMode?: "per_token" | "subscription";
  subscriptionMonthlyCostUsd?: number | null;
  subscriptionStartedAt?: string | null;
};

export type UpdateLlmProviderRequest = Partial<
  Omit<CreateLlmProviderRequest, "name" | "apiKey">
> & {
  apiKey?: string | null;
};

export type SmokeTestResultApi = {
  provider: string;
  success: boolean;
  durationSeconds: number;
  error?: string;
};

export type DiscoverModelsResultApi =
  | { ok: true; models: Array<{ id: string; alreadyInCatalog: boolean }> }
  | { ok: false; error: string };

export type DiscoverModelsPreviewRequest = {
  baseUrl: string;
  protocolKind: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
};

export type DiscoverModelsPreviewResultApi =
  | { ok: true; models: Array<{ id: string }> }
  | { ok: false; error: string };

export type RemovalImpactApi = {
  providerName: string;
  isDefault: boolean;
  affectedRoutesCount: number;
  affectedTenantsCount: number;
  inDefaultChain: boolean;
  currentDefault: { providerName: string; model: string | null } | null;
};
