import { apiClient } from './api-client';

/**
 * API DTO для интеграции с Чат боксом (ТЗ 2026-06-05 chatbox-integration,
 * Фаза 7). Контракт — `backend/src/modules/chatbox/`.
 *
 * Все эндпоинты под `CookieAuthGuard` + `TenantGuard`; `X-Org-Id`
 * подставляется `apiClient`'ом автоматически.
 *
 * Backend никогда не возвращает плейн-токен — вместо него флаг `hasToken`.
 */

export type ChatboxSyncMode = 'hourly' | 'daily' | 'realtime';
export type ChatboxStatus = 'connected' | 'error' | 'disconnected';

export type ChatboxIntegrationApi = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  syncMode: ChatboxSyncMode;
  status: ChatboxStatus;
  lastError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatboxWorkspaceApi = {
  id: string;
  name: string;
  description?: string;
  role: string;
};

export type ChatboxSyncCountsApi = {
  chats: number;
  messages: number;
  customers: number;
  channelClients: number;
  members: number;
  sessions: number;
};

export type ChatboxSyncStatusApi =
  | { configured: false }
  | {
      lastFullSyncAt: string | null;
      lastIncrementalSyncAt: string | null;
      status: ChatboxStatus;
      lastError: string | null;
      counts: ChatboxSyncCountsApi;
    };

export type ChatboxSyncScope = 'all' | 'customers' | 'managers' | 'chats';

export type SaveChatboxIntegrationRequest = {
  token?: string;
  workspaceId: string;
  syncMode: ChatboxSyncMode;
};

export const chatboxApi = {
  getIntegration: () =>
    apiClient.get<ChatboxIntegrationApi | null>('/api/v1/chatbox/integration'),

  listWorkspaces: (token: string) =>
    apiClient.post<{ workspaces: ChatboxWorkspaceApi[]; total: number }>(
      '/api/v1/chatbox/integration/workspaces',
      { token },
    ),

  saveIntegration: (body: SaveChatboxIntegrationRequest) =>
    apiClient.put<ChatboxIntegrationApi>('/api/v1/chatbox/integration', body),

  deleteIntegration: () =>
    apiClient.del<{ ok: true }>('/api/v1/chatbox/integration'),

  sync: (scope: ChatboxSyncScope) =>
    apiClient.post<{ ok: true; jobId: string }>(
      '/api/v1/chatbox/integration/sync',
      { scope },
    ),

  syncStatus: () =>
    apiClient.get<ChatboxSyncStatusApi>('/api/v1/chatbox/integration/sync/status'),
};
