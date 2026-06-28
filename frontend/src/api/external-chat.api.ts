import { apiClient } from "./api-client";

export type ExternalMessageApi = {
  id: string;
  conversationId: string;
  seq: string;
  authorUserId: string;
  authorType: string;
  access: string;
  content: string;
  parentMessageId: string | null;
  voiceUrl: string | null;
  voiceDuration: number | null;
  mentions: string[];
  reactions: unknown;
  createdAt: string;
  editedAt: string | null;
};

export type ExternalAccessResponseApi = { conversationId: string };

export type ExternalListMessagesResponseApi = {
  items: ExternalMessageApi[];
  nextSeq: string | null;
};

export type ExternalSendMessageResponseApi = {
  messageId: string;
  seq: string;
};

export type ExternalOkResponseApi = { ok: true };

export type ExternalRegisterResponseApi = { ok: true; verified: true };

export type ExternalContact = { email?: string; phone?: string };

export const externalChatApi = {
  access: (token: string) =>
    apiClient.post<ExternalAccessResponseApi>("/api/v1/external/access", {
      token,
    }),

  listMessages: (conversationId: string, sinceSeq?: string | null) => {
    const query = sinceSeq
      ? `?sinceSeq=${encodeURIComponent(sinceSeq)}`
      : "";
    return apiClient.get<ExternalListMessagesResponseApi>(
      `/api/v1/external/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
    );
  },

  sendMessage: (
    conversationId: string,
    body: { content: string; clientMessageId: string },
  ) =>
    apiClient.post<ExternalSendMessageResponseApi>(
      `/api/v1/external/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
    ),

  requestRegisterCode: (token: string, contact: ExternalContact) =>
    apiClient.post<ExternalOkResponseApi>(
      "/api/v1/external/register/request-code",
      { token, ...contact },
    ),

  register: (token: string, contact: ExternalContact, code: string) =>
    apiClient.post<ExternalRegisterResponseApi>("/api/v1/external/register", {
      token,
      ...contact,
      code,
    }),

  report: (conversationId: string) =>
    apiClient.post<ExternalOkResponseApi>(
      `/api/v1/external/conversations/${encodeURIComponent(conversationId)}/report`,
    ),
};
