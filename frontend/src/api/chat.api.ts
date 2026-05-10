import { apiClient } from './api-client';

/**
 * API DTO для модуля chat (AI-чат).
 * Источник правды:
 *   - legacy: backend/src/modules/chat/chat.service.ts (interface ChatAnswer);
 *   - v2:     backend/src/modules/knowledge-core/services/chat-v2.service.ts (ChatV2Output).
 */

export type ChatCitationApi = {
  meetingId: string;
  meetingTitle?: string;
  startMs: number;
  endMs: number;
  snippet: string;
};

export type ChatMessageApi = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitationApi[];
  modelUsed: string | null;
  createdAt: string;
};

export type ChatHistoryApi = { items: ChatMessageApi[] };

export type ChatRequestBody = { message: string };

/**
 * Ответ от ChatService.askSingleMeeting / askCrossMeeting:
 *   { message: string, citations: AnswerCitation[], modelUsed: string }
 */
export type ChatResponseApi = {
  message: string;
  citations: ChatCitationApi[];
  modelUsed: string;
};

/**
 * Scope для ChatV2 unified endpoint.
 *   - org    — общая база знаний организации (scopeId не нужен).
 *   - meeting— одна встреча (scopeId = meetingId).
 *   - card   — одна карточка (scopeId = cardId).
 *   - theme  — одна AI-тема (scopeId = themeId).
 *   - entity — одна сущность (scopeId = entityId).
 */
export type ChatV2Scope = 'org' | 'meeting' | 'card' | 'theme' | 'entity';

export type ChatV2AskBody = {
  scope: ChatV2Scope;
  scopeId?: string | null;
  query: string;
};

/** Расширенный shape ответа ChatV2 (включает usedBlockIds для отладки/UI). */
export type ChatV2ResponseApi = {
  message: string;
  citations: ChatCitationApi[];
  modelUsed: string;
  usedBlockIds: string[];
};

export const chatApi = {
  /** Single-meeting (legacy эндпоинт; backend сам решает legacy/v2 по флагу). */
  sendMeeting: (meetingId: string, body: ChatRequestBody) =>
    apiClient.post<ChatResponseApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chat`,
      body,
    ),

  historyMeeting: (meetingId: string) =>
    apiClient.get<ChatHistoryApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chat/history`,
    ),

  /** Cross-meeting (legacy эндпоинт; backend сам решает legacy/v2 по флагу). */
  sendGlobal: (body: ChatRequestBody) =>
    apiClient.post<ChatResponseApi>(`/api/v1/chat`, body),

  historyGlobal: () => apiClient.get<ChatHistoryApi>(`/api/v1/chat/history`),

  /**
   * ChatV2 unified endpoint. Когда `CHAT_V2_ENABLED=false` на бэкенде —
   * возвращает 503 `chat_v2_disabled`. Фронт делает graceful fallback
   * на legacy через `askWithGracefulFallback`.
   */
  askV2: (body: ChatV2AskBody) =>
    apiClient.post<ChatV2ResponseApi>(`/api/v1/chat/v2`, body),
};
