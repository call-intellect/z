/**
 * API-клиент SBA α-5 — Layer 5 Chat-v2 Omnichannel.
 *
 * Эндпоинты — см. `backend/src/modules/chat-v2/chat-v2.controller.ts`.
 *
 *   POST   /api/v1/chat-v2/messages
 *   GET    /api/v1/chat-v2/conversations
 *   GET    /api/v1/chat-v2/conversations/:id
 *   POST   /api/v1/chat-v2/conversations/:id/pin
 *   POST   /api/v1/chat-v2/conversations/:id/archive
 */

import { apiClient } from './api-client';

export type ChatV2ScopeApi =
  | 'org'
  | 'meeting'
  | 'card'
  | 'theme'
  | 'entity'
  | 'personal'
  // Wave 2 polish T6-6b — первоклассный scope для чат-в-задаче (IssueChat).
  // Backend маппит 'issue' → 'card' для retrieval (см. SynthesisService.mapScope).
  | 'issue';

export type ChatV2ModeApi = 'factual' | 'synthetic' | 'clone_style';

export type ChatV2ConversationStatusApi = 'active' | 'archived';

export type ChatV2MessageRoleApi = 'user' | 'assistant';

export interface ChatV2CitationApi {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
}

export interface ChatV2ConversationApi {
  id: string;
  tenantId: string;
  userId: string;
  title: string | null;
  scope: ChatV2ScopeApi;
  scopeRefId: string | null;
  channelKindOrigin: string | null;
  status: ChatV2ConversationStatusApi;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatV2MessageApi {
  id: string;
  conversationId: string;
  role: ChatV2MessageRoleApi;
  mode: ChatV2ModeApi | null;
  text: string;
  citations: ChatV2CitationApi[] | null;
  retrievalMeta: Record<string, unknown> | null;
  llmMeta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatV2ConversationWithMessagesApi
  extends ChatV2ConversationApi {
  messages: ChatV2MessageApi[];
}

export interface ChatV2AskBody {
  question: string;
  conversationId?: string;
  mode?: ChatV2ModeApi;
  scope?: ChatV2ScopeApi;
  scopeRefId?: string | null;
  /**
   * SBA α-5 dialog-layer — temporal queries («что мы знали тогда»).
   * ISO 8601 datetime. UI может предложить DateRange picker.
   */
  asOf?: string;
}

export interface ChatV2AskResponseApi {
  conversationId: string;
  messageId: string;
  text: string;
  citations: ChatV2CitationApi[];
  uncertaintyNote: string | null;
  mode: ChatV2ModeApi;
  /**
   * SBA α-5 dialog-layer — true, если ответ извлечён из AnswerCache
   * (0 LLM calls). UI показывает subtle badge «из кэша».
   */
  cacheHit: boolean;
}

export interface ChatV2ListConversationsQuery {
  status?: ChatV2ConversationStatusApi;
  scope?: ChatV2ScopeApi;
  page?: number;
  limit?: number;
}

export interface ChatV2ListConversationsResponseApi {
  items: ChatV2ConversationApi[];
  total: number;
  page: number;
  limit: number;
}

export const chatV2Api = {
  ask: (body: ChatV2AskBody) =>
    apiClient.post<ChatV2AskResponseApi>('/api/v1/chat-v2/messages', body),

  listConversations: (query?: ChatV2ListConversationsQuery) => {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (query?.scope) params.set('scope', query.scope);
    if (query?.page) params.set('page', String(query.page));
    if (query?.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiClient.get<ChatV2ListConversationsResponseApi>(
      `/api/v1/chat-v2/conversations${qs ? `?${qs}` : ''}`,
    );
  },

  getConversation: (id: string) =>
    apiClient.get<ChatV2ConversationWithMessagesApi>(
      `/api/v1/chat-v2/conversations/${encodeURIComponent(id)}`,
    ),

  pinConversation: (id: string, pinned: boolean) =>
    apiClient.post<ChatV2ConversationApi>(
      `/api/v1/chat-v2/conversations/${encodeURIComponent(id)}/pin`,
      { pinned },
    ),

  archiveConversation: (id: string) =>
    apiClient.post<ChatV2ConversationApi>(
      `/api/v1/chat-v2/conversations/${encodeURIComponent(id)}/archive`,
      {},
    ),

  /**
   * SBA α-5 dialog-layer — очистка AnswerCache+RetrievalCache по
   * conversationId. Доступно владельцу диалога.
   */
  clearCache: (id: string) =>
    apiClient.post<{
      answerDeleted: number;
      retrievalDeleted: number;
    }>(
      `/api/v1/chat-v2/conversations/${encodeURIComponent(id)}/clear-cache`,
      {},
    ),
};
