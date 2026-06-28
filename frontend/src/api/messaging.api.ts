import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";
import type {
  ConversationKind,
  InboxLinkedIssueApi,
  ListMessagesResponseApi,
  ListThreadsResponseApi,
  MessageAccess,
  ReactionsResponseApi,
  SearchMessageItemApi,
  SendMessageResponseApi,
} from "@/domain/messaging";

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
  access?: MessageAccess;
  mentions?: string[];
}

export interface CreateConversationBody {
  kind: "dm" | "group" | "channel";
  title?: string;
  memberUserIds: string[];
}

function buildThreadsQuery(params: ListThreadsParams): string {
  const qs = new URLSearchParams();
  qs.set("type", params.type);
  qs.set("sort", params.sort);
  if (params.q) qs.set("q", params.q);
  if (params.cursor) qs.set("cursor", params.cursor);
  return qs.toString();
}

export const messagingApi = {
  listThreads: (orgId: string, params: ListThreadsParams) =>
    apiClient.get<ListThreadsResponseApi>(
      `/api/v1/message-threads?${buildThreadsQuery(params)}`,
      { headers: orgHeaders(orgId) },
    ),

  unreadCount: (orgId: string) =>
    apiClient.get<{ total: number }>(
      `/api/v1/message-threads/unread-count`,
      { headers: orgHeaders(orgId) },
    ),

  listMessages: (
    orgId: string,
    conversationId: string,
    sinceSeq?: string | null,
  ) => {
    const qs = new URLSearchParams();
    if (sinceSeq) qs.set("sinceSeq", sinceSeq);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiClient.get<ListMessagesResponseApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
      { headers: orgHeaders(orgId) },
    );
  },

  sendMessage: (orgId: string, conversationId: string, body: SendMessageBody) =>
    apiClient.post<SendMessageResponseApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  toggleReaction: (
    orgId: string,
    conversationId: string,
    messageId: string,
    emoji: string,
  ) =>
    apiClient.post<ReactionsResponseApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      { emoji },
      { headers: orgHeaders(orgId) },
    ),

  markRead: (orgId: string, conversationId: string, cursorSeq: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/message-threads/${encodeURIComponent(conversationId)}/read`,
      { cursorSeq },
      { headers: orgHeaders(orgId) },
    ),

  createConversation: (orgId: string, body: CreateConversationBody) =>
    apiClient.post<{ conversationId: string }>(
      `/api/v1/conversations`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  searchMessages: (orgId: string, q: string, type: InboxThreadType = "all") => {
    const qs = new URLSearchParams();
    qs.set("q", q);
    qs.set("type", type);
    return apiClient.get<{ items: SearchMessageItemApi[] }>(
      `/api/v1/message-search?${qs.toString()}`,
      { headers: orgHeaders(orgId) },
    );
  },

  linkedIssue: (orgId: string, conversationId: string) =>
    apiClient.get<InboxLinkedIssueApi>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/linked-issue`,
      { headers: orgHeaders(orgId) },
    ),

  issueConversation: (orgId: string, issueId: string) =>
    apiClient.get<{ conversationId: string }>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/conversation`,
      { headers: orgHeaders(orgId) },
    ),
};

export type { ConversationKind };
