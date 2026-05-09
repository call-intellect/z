import { apiClient } from './api-client';

/**
 * API DTO для модуля chat (AI-чат по встрече и cross-meeting).
 * Источник правды — backend/src/modules/chat/chat.service.ts (interface ChatAnswer).
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

export const chatApi = {
  /** Single-meeting (context-stuffing). */
  sendMeeting: (meetingId: string, body: ChatRequestBody) =>
    apiClient.post<ChatResponseApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chat`,
      body,
    ),

  historyMeeting: (meetingId: string) =>
    apiClient.get<ChatHistoryApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chat/history`,
    ),

  /** Cross-meeting RAG (over pgvector chunks юзера). */
  sendGlobal: (body: ChatRequestBody) =>
    apiClient.post<ChatResponseApi>(`/api/v1/chat`, body),

  historyGlobal: () => apiClient.get<ChatHistoryApi>(`/api/v1/chat/history`),
};
