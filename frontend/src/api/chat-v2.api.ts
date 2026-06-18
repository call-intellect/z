import { apiClient, getApiClientOrgId } from "./api-client";

export type ChatV2ScopeApi =
  | "org"
  | "meeting"
  | "card"
  | "theme"
  | "entity"
  | "personal"
  | "issue";

export type ChatV2ModeApi = "factual" | "synthetic" | "clone_style";

export type ChatV2ConversationStatusApi = "active" | "archived";

export type ChatV2MessageRoleApi = "user" | "assistant";

export interface ChatV2CitationApi {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
  documentId?: string;
  documentName?: string;
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

export interface ChatV2ConversationWithMessagesApi extends ChatV2ConversationApi {
  messages: ChatV2MessageApi[];
}

export interface ChatV2AskBody {
  question: string;
  conversationId?: string;
  mode?: ChatV2ModeApi;
  scope?: ChatV2ScopeApi;
  scopeRefId?: string | null;
  asOf?: string;
}

export interface ChatV2AskResponseApi {
  conversationId: string;
  messageId: string;
  text: string;
  citations: ChatV2CitationApi[];
  uncertaintyNote: string | null;
  mode: ChatV2ModeApi;
  cacheHit: boolean;
}

export type ChatV2StreamEvent =
  | { type: "stage"; stage: "understanding" | "searching" | "writing" }
  | ({ type: "done" } & ChatV2AskResponseApi)
  | { type: "error"; code: string; message: string };

export async function* streamChatV2Message(
  body: ChatV2AskBody,
  signal?: AbortSignal,
): AsyncGenerator<ChatV2StreamEvent, void, unknown> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const orgId = getApiClientOrgId();
  const res = await fetch(`${baseUrl}/api/v1/chat-v2/messages/stream`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(orgId ? { "X-Org-Id": orgId } : {}),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat-v2 stream: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (raw.startsWith(":")) continue;
        const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        try {
          const ev = JSON.parse(payload) as ChatV2StreamEvent;
          yield ev;
          if (ev.type === "done" || ev.type === "error") {
            return;
          }
        } catch {}
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
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

export interface ChatV2UsageStatsApi {
  from: string;
  to: string;
  scope: "self" | "org";
  asked: number;
  answered: number;
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
  helpedRatePercent: number | null;
  feedbackCoveragePercent: number;
  groundedRatePercent: number;
  helpedRateHidden: boolean;
  minRated: number;
}

export interface ChatV2UsageStatsQuery {
  from?: string;
  to?: string;
  scope?: "self" | "org";
}

export const chatV2Api = {
  ask: (body: ChatV2AskBody) =>
    apiClient.post<ChatV2AskResponseApi>("/api/v1/chat-v2/messages", body),

  listConversations: (query?: ChatV2ListConversationsQuery) => {
    const params = new URLSearchParams();
    if (query?.status) params.set("status", query.status);
    if (query?.scope) params.set("scope", query.scope);
    if (query?.page) params.set("page", String(query.page));
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return apiClient.get<ChatV2ListConversationsResponseApi>(
      `/api/v1/chat-v2/conversations${qs ? `?${qs}` : ""}`,
    );
  },

  getConversation: (id: string) =>
    apiClient.get<ChatV2ConversationWithMessagesApi>(
      `/api/v1/chat-v2/conversations/${encodeURIComponent(id)}`,
    ),

  usageStats: (query?: ChatV2UsageStatsQuery) => {
    const params = new URLSearchParams();
    if (query?.from) params.set("from", query.from);
    if (query?.to) params.set("to", query.to);
    if (query?.scope) params.set("scope", query.scope);
    const qs = params.toString();
    return apiClient.get<ChatV2UsageStatsApi>(
      `/api/v1/chat-v2/usage-stats${qs ? `?${qs}` : ""}`,
    );
  },

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

  setFeedback: (messageId: string, helpful: "up" | "down", comment?: string) =>
    apiClient.post<{ messageId: string; helpful: "up" | "down" }>(
      `/api/v1/chat-v2/messages/${encodeURIComponent(messageId)}/feedback`,
      comment !== undefined ? { helpful, comment } : { helpful },
    ),

  clearFeedback: (messageId: string) =>
    apiClient.del<{ messageId: string; cleared: boolean }>(
      `/api/v1/chat-v2/messages/${encodeURIComponent(messageId)}/feedback`,
    ),

  clearCache: (id: string) =>
    apiClient.post<{
      answerDeleted: number;
      retrievalDeleted: number;
    }>(
      `/api/v1/chat-v2/conversations/${encodeURIComponent(id)}/clear-cache`,
      {},
    ),
};
