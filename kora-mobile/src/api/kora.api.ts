import { apiClient } from "./client";

export interface AskKoraSourceApi {
  messageId: string;
  conversationId: string;
}

export interface AskKoraResponseApi {
  answer: string;
  sourceMessageIds: string[];
}

export const koraApi = {
  ask: (conversationId: string, question: string) =>
    apiClient.post<AskKoraResponseApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/ask`,
      { question },
    ),
};
