import { apiClient } from './api-client';

/**
 * API-слой Bitrix24-интеграции (ApiDto).
 * Бэк: backend/src/modules/bitrix. Контракт: токены наружу не отдаются —
 * только `hasTokens`.
 */

export type BitrixIntegrationStatus =
  | 'pending'
  | 'connected'
  | 'error'
  | 'disconnected';

export interface BitrixIntegrationApi {
  id: string;
  portalDomain: string;
  status: BitrixIntegrationStatus;
  scope: string | null;
  hasTokens: boolean;
  lastError: string | null;
  accessExpiresAt: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const bitrixApi = {
  getIntegration: () =>
    apiClient.get<BitrixIntegrationApi | null>('/api/v1/bitrix/integration'),

  /** URL авторизации Bitrix24 для подключения портала (открыть в браузере). */
  getAuthorizeUrl: (domain: string) =>
    apiClient.get<{ url: string }>(
      '/api/v1/bitrix/integration/authorize-url?domain=' +
        encodeURIComponent(domain),
    ),

  /** Проверка соединения (app.info). */
  test: () =>
    apiClient.post<{ ok: true; app: Record<string, unknown> }>(
      '/api/v1/bitrix/integration/test',
      {},
    ),

  /** Привязать установку из Маркета (по memberId) к текущей org. */
  claim: (memberId: string) =>
    apiClient.post<BitrixIntegrationApi>('/api/v1/bitrix/integration/claim', {
      memberId,
    }),

  deleteIntegration: () =>
    apiClient.del<{ ok: true }>('/api/v1/bitrix/integration'),
};
