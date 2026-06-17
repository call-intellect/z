import { apiClient } from "./api-client";

export type ChatCitationApi = {
  meetingId: string;
  meetingTitle?: string;
  startMs: number;
  endMs: number;
  snippet: string;
};

export type ChatMessageApi = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitationApi[];
  modelUsed: string | null;
  createdAt: string;
};

export type ChatHistoryApi = { items: ChatMessageApi[] };

export type ChatRequestBody = { message: string };

export type ChatResponseApi = {
  message: string;
  citations: ChatCitationApi[];
  modelUsed: string;
};

export type ChatV2Scope = "org" | "meeting" | "card" | "theme" | "entity";

export type ChatV2AskBody = {
  scope: ChatV2Scope;
  scopeId?: string | null;
  query: string;
};

export type ChatV2ResponseApi = {
  message: string;
  citations: ChatCitationApi[];
  modelUsed: string;
  usedBlockIds: string[];
};

export const chatApi = {
  sendMeeting: (meetingId: string, body: ChatRequestBody) =>
    apiClient.post<ChatResponseApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chat`,
      body,
    ),

  historyMeeting: (meetingId: string) =>
    apiClient.get<ChatHistoryApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chat/history`,
    ),

  sendGlobal: (body: ChatRequestBody) =>
    apiClient.post<ChatResponseApi>(`/api/v1/chat`, body),

  historyGlobal: () => apiClient.get<ChatHistoryApi>(`/api/v1/chat/history`),

  askV2: (body: ChatV2AskBody) =>
    apiClient.post<ChatV2ResponseApi>(`/api/v1/chat/v2`, body),
};
