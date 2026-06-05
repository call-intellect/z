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

// --- Просмотр чатов (ТЗ 2026-06-05 chatbox-integration, Фаза 8) ---

export type ChatboxChatStatusApi = 'active' | 'closed';

export type ChatboxPartyApi = {
  externalId: string;
  name: string;
};

export type ChatboxChatApi = {
  id: string;
  externalId: string;
  channelType: string;
  status: ChatboxChatStatusApi;
  customer: ChatboxPartyApi | null;
  clientName: string;
  responsible: ChatboxPartyApi | null;
  lastMessageAt: string | null;
  messageCount: number;
  externalCreatedAt: string | null;
};

export type MessengerIdentityApi = {
  channelType: string;
  externalId: string;
  name: string;
  avatarUrl: string | null;
};

export type ChatboxSessionApi = {
  id: string;
  seq: number;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  analysisStatus: string;
  previousSessionId: string | null;
};

export type ChatboxChatDetailApi = ChatboxChatApi & {
  externalUpdatedAt: string | null;
  sessions: ChatboxSessionApi[];
  messengerIdentities: MessengerIdentityApi[];
};

export type ChatboxSenderTypeApi =
  | 'CLIENT'
  | 'USER'
  | 'ASSISTANT'
  | 'QUALITY_CONTROL';

export type ChatboxContentTypeApi =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'VIDEO_NOTE'
  | 'FILE'
  | 'VOICE'
  | 'COMMAND';

export type ChatboxMessageApi = {
  id: string;
  senderType: ChatboxSenderTypeApi;
  senderName: string;
  contentType: ChatboxContentTypeApi;
  text: string | null;
  imageUrl: string | null;
  fileUrl: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  externalCreatedAt: string | null;
  isOutboundFromKora: boolean;
  sessionId: string | null;
};

// --- Менеджеры → сотрудники (ТЗ 2026-06-05 chatbox-integration, Фаза 9) ---

export type ChatboxLinkMode = 'auto' | 'manual' | 'none';

export type ChatboxMemberApi = {
  id: string;
  externalId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  linkMode: ChatboxLinkMode;
  linkedPerson: { id: string; name: string | null } | null;
};

export type ListChatsQuery = {
  status?: ChatboxChatStatusApi;
  channelType?: string;
  customerExternalId?: string;
  limit?: number;
  offset?: number;
};

export type ListMessagesQuery = {
  limit?: number;
  offset?: number;
};

function buildQuery(q?: Record<string, string | number | undefined>): string {
  if (!q) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

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

  // --- Просмотр чатов (Фаза 8) ---

  listChats: (q?: ListChatsQuery) =>
    apiClient.get<{ items: ChatboxChatApi[]; total: number }>(
      '/api/v1/chatbox/chats' + buildQuery(q),
    ),

  getChat: (id: string) =>
    apiClient.get<ChatboxChatDetailApi>(
      '/api/v1/chatbox/chats/' + encodeURIComponent(id),
    ),

  listMessages: (id: string, q?: ListMessagesQuery) =>
    apiClient.get<{ items: ChatboxMessageApi[]; total: number }>(
      '/api/v1/chatbox/chats/' + encodeURIComponent(id) + '/messages' + buildQuery(q),
    ),

  sendMessage: (id: string, text: string) =>
    apiClient.post<{ ok: true; id: string }>(
      '/api/v1/chatbox/chats/' + encodeURIComponent(id) + '/messages',
      { text },
    ),

  // --- Менеджеры → сотрудники (Фаза 9) ---

  listMembers: () =>
    apiClient.get<ChatboxMemberApi[]>('/api/v1/chatbox/members'),

  linkMember: (id: string, personId: string | null) =>
    apiClient.put<{ ok: true; member: ChatboxMemberApi }>(
      '/api/v1/chatbox/members/' + encodeURIComponent(id) + '/link',
      { personId },
    ),
};
