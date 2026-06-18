import { apiClient } from "./api-client";

export interface ConciergePageContextApi {
  clientPath?: string;
  currentEntityKind?: string;
  currentEntityId?: string;
  extras?: Record<string, unknown>;
}

export interface ConciergePostMessageBody {
  userMessage: string;
  conversationId?: string;
  pageContext?: ConciergePageContextApi;
  noStream?: boolean;
}

export type ConciergeStreamEvent =
  | { type: "started"; conversationId: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_call";
      toolName: string;
      params: Record<string, unknown>;
      requiresConfirm: boolean;
    }
  | {
      type: "tool_result";
      toolName: string;
      ok: boolean;
      status: number;
      undoLogId?: string;
      preview: string;
      data?: unknown;
    }
  | { type: "message"; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; code: string; message: string }
  | { type: "quota_exceeded"; scope: "daily" | "monthly" };

export interface ConciergeOnceResponseApi {
  conversationId: string;
  messageId: string | null;
  text: string;
  toolCalls: Array<{
    toolName: string;
    ok: boolean;
    status: number;
    undoLogId?: string;
  }>;
  quotaExceeded?: "daily" | "monthly";
  error?: { code: string; message: string };
}

export interface ConciergeConversationApi {
  id: string;
  startedAt: string;
  lastMessageAt: string | null;
  summary: string | null;
  archivedAt: string | null;
}

export interface ConciergeMessageApi {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface ConciergeConversationDetailApi {
  id: string;
  summary: string | null;
  messages: ConciergeMessageApi[];
}

export interface ConciergeQuotaApi {
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
}

export async function* streamConciergeMessage(
  body: ConciergePostMessageBody,
  signal?: AbortSignal,
): AsyncGenerator<ConciergeStreamEvent, void, unknown> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/concierge/messages`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Concierge SSE: HTTP ${res.status}`);
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
          const ev = JSON.parse(payload) as ConciergeStreamEvent;
          yield ev;
          if (
            ev.type === "done" ||
            ev.type === "error" ||
            ev.type === "quota_exceeded"
          ) {
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

export const conciergeApi = {
  askOnce: (body: ConciergePostMessageBody) =>
    apiClient.post<ConciergeOnceResponseApi>(
      "/api/v1/concierge/messages/once",
      body,
    ),

  listConversations: (archived?: boolean, page = 1, limit = 20) => {
    const usp = new URLSearchParams();
    if (archived) usp.set("archived", "true");
    usp.set("page", String(page));
    usp.set("limit", String(limit));
    return apiClient.get<{
      items: ConciergeConversationApi[];
      total: number;
      page: number;
      limit: number;
    }>(`/api/v1/concierge/conversations?${usp.toString()}`);
  },

  getConversation: (id: string) =>
    apiClient.get<ConciergeConversationDetailApi>(
      `/api/v1/concierge/conversations/${encodeURIComponent(id)}`,
    ),

  undo: (logId: string) =>
    apiClient.post<{ ok: boolean; status: number; message?: string }>(
      `/api/v1/concierge/undo/${encodeURIComponent(logId)}`,
      {},
    ),

  getQuota: () => apiClient.get<ConciergeQuotaApi>("/api/v1/concierge/quota"),
};

export const conciergeStreamApi = streamConciergeMessage;
