import { apiClient } from "./client";

export type ConversationKindApi =
  | "dm"
  | "group"
  | "channel"
  | "work_chat"
  | "external"
  | "ticket";

export type MessageAccessApi = "normal" | "internal" | "external";

export type InboxThreadType =
  | "all"
  | "dm"
  | "group"
  | "channel"
  | "work_chat"
  | "external"
  | "ticket"
  | "unread";

export type InboxSort = "recent" | "active" | "unread";

export interface InboxLinkedIssueApi {
  id: string;
  identifier: string;
  title: string;
}

export interface InboxItemApi {
  kind: ConversationKindApi;
  refId: string;
  title: string;
  snippet: string;
  lastMessageAt: string | null;
  unreadCount: number;
  status: string | null;
  slaBreachedAt: string | null;
  linkedIssue: InboxLinkedIssueApi | null;
}

export interface ListThreadsResponseApi {
  items: InboxItemApi[];
  nextCursor: string | null;
}

export interface MessageApi {
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
  reactions: Record<string, string[]> | null;
  createdAt: string;
  editedAt: string | null;
}

export interface ListMessagesResponseApi {
  items: MessageApi[];
  nextSeq: string | null;
}

export interface SendMessageResponseApi {
  message: MessageApi;
  deduped: boolean;
}

export interface ListThreadsParams {
  type: InboxThreadType;
  sort: InboxSort;
  q?: string | null;
  cursor?: string | null;
}

export interface SendMessageBody {
  content: string;
  clientMessageId: string;
  parentMessageId?: string;
  access?: MessageAccessApi;
  mentions?: string[];
}

function buildThreadsQuery(params: ListThreadsParams): string {
  const qs = new URLSearchParams();
  qs.set("type", params.type);
  qs.set("sort", params.sort);
  if (params.q) qs.set("q", params.q);
  if (params.cursor) qs.set("cursor", params.cursor);
  return qs.toString();
}

export const threadsApi = {
  list: (params: ListThreadsParams) =>
    apiClient.get<ListThreadsResponseApi>(
      `/api/v1/message-threads?${buildThreadsQuery(params)}`,
    ),

  unreadCount: () =>
    apiClient.get<{ total: number }>("/api/v1/message-threads/unread-count"),

  listMessages: (conversationId: string, sinceSeq?: string | null) => {
    const qs = new URLSearchParams();
    if (sinceSeq) qs.set("sinceSeq", sinceSeq);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiClient.get<ListMessagesResponseApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    );
  },

  sendMessage: (conversationId: string, body: SendMessageBody) =>
    apiClient.post<SendMessageResponseApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
    ),

  markRead: (conversationId: string, cursorSeq: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/message-threads/${encodeURIComponent(conversationId)}/read`,
      { cursorSeq },
    ),

  blockMember: (conversationId: string, userId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/block-member`,
      { userId },
    ),

  reportMessage: (messageId: string, reason?: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/messages/${encodeURIComponent(messageId)}/report`,
      { reason },
    ),
};
