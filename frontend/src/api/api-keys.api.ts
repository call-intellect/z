import { apiClient } from './api-client';

/**
 * API DTO для Public API ключей юзера. Контракт — `backend/src/modules/api-keys/`.
 *
 * `rawKey` отдаётся бэкендом ТОЛЬКО при создании. После — юзер видит лишь `prefix`.
 */

export type ApiKeyScope = 'read' | 'write';

export type ApiKeyApi = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type ApiKeysListApiResponse = { items: ApiKeyApi[] };

export type CreateApiKeyRequest = {
  name: string;
  scopes: ApiKeyScope[];
};

export type CreateApiKeyApiResponse = {
  id: string;
  name: string;
  prefix: string;
  rawKey: string;
  scopes: ApiKeyScope[];
};

export const apiKeysApi = {
  list: () => apiClient.get<ApiKeysListApiResponse>('/api/v1/api-keys'),

  create: (body: CreateApiKeyRequest) =>
    apiClient.post<CreateApiKeyApiResponse>('/api/v1/api-keys', body),

  revoke: (id: string) =>
    apiClient.del<void>(`/api/v1/api-keys/${encodeURIComponent(id)}`),
};
