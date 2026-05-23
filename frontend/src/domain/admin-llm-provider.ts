/**
 * SBA α-10 wave 3 — DomainModel для LlmProvider.
 *
 * Контракт: backend `AdminLlmProvidersService.list`.
 */
export type AdminLlmProviderApi = {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind: string;
  capability: string;
  isActive: boolean;
  hasApiKey: boolean;
  defaultHeaders: Record<string, string> | null;
  globalRps: number | null;
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
  hasApiKey: boolean;
  defaultHeaders: Record<string, string> | null;
  globalRps: number | null;
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
    hasApiKey: api.hasApiKey,
    defaultHeaders: api.defaultHeaders,
    globalRps: api.globalRps,
    lastSmokeAt: api.lastSmokeAt ? new Date(api.lastSmokeAt) : null,
    lastSmokeSuccess: api.lastSmokeSuccess,
    lastSmokeError: api.lastSmokeError,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export type CreateLlmProviderRequest = {
  name: string;
  displayName: string;
  baseUrl: string;
  protocolKind:
    | 'openai-chat'
    | 'openai-responses'
    | 'anthropic-messages'
    | 'ollama-native'
    | 'custom-http';
  capability?: 'public' | 'internal' | 'sensitive' | 'private';
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  globalRps?: number;
  isActive?: boolean;
};

export type UpdateLlmProviderRequest = Partial<
  Omit<CreateLlmProviderRequest, 'name'>
>;

export type SmokeTestResultApi = {
  provider: string;
  success: boolean;
  durationSeconds: number;
  error?: string;
};
