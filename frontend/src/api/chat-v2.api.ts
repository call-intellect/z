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
  /**
   * ТЗ-4 Ф11 — провенанс документа. Если блок происходит из загруженного
   * документа, citation несёт ссылку на него (`/documents/<documentId>`).
   */
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

/**
 * §4 Ф1 — событие SSE-стрима ответа AI-чата (стадии «думанья» + финал).
 * Контракт: `POST /api/v1/chat-v2/messages/stream` (тело — `ChatV2AskBody`).
 *   - `stage` — текущая стадия: понимаю вопрос / ищу в памяти / пишу ответ.
 *   - `done` — финал, несёт весь `ChatV2AskResponseApi`.
 *   - `error` — серверная ошибка стрима (caller делает fallback на sync).
 * Heartbeat-строки (начинаются с `:`) игнорируются на уровне парсера.
 */
export type ChatV2StreamEvent =
  | { type: 'stage'; stage: 'understanding' | 'searching' | 'writing' }
  | ({ type: 'done' } & ChatV2AskResponseApi)
  | { type: 'error'; code: string; message: string };

/**
 * §4 Ф1 — SSE-стрим ответа AI-чата. Async-генератор: отдаёт стадии «думанья»
 * и финальное событие `done` с готовым ответом.
 *
 * Kill-switch OFF → сервер отвечает HTTP 503 ДО SSE; любой не-OK статус (и
 * отсутствие тела) → бросаем — вызывающий перехватывает и делает прозрачный
 * откат на синхронный `chatV2Api.ask`.
 *
 * Закрытие: вызывающий передаёт `signal` от `AbortController` и вызывает
 * `abort()` при размонтировании/смене диалога.
 */
export async function* streamChatV2Message(
  body: ChatV2AskBody,
  signal?: AbortSignal,
): AsyncGenerator<ChatV2StreamEvent, void, unknown> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/v1/chat-v2/messages/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat-v2 stream: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE: события разделены `\n\n`.
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // Игнорируем heartbeat (`: heartbeat`).
        if (raw.startsWith(':')) continue;
        const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        try {
          const ev = JSON.parse(payload) as ChatV2StreamEvent;
          yield ev;
          if (ev.type === 'done' || ev.type === 'error') {
            return;
          }
        } catch {
          // skip malformed
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* */
    }
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

/**
 * TZ-1 Фаза 5 — метрика чата за окно.
 * Контракт: `GET /api/v1/chat-v2/usage-stats?from=&to=&scope=self|org`.
 * Источник: `backend/.../dto/chat-v2-feedback.dto.ts:ChatV2UsageStatsDto`.
 *
 * `helpedRateHidden=true` → процент «помог ли ответ» скрыт (rated < minRated),
 * UI показывает «мало данных». `answeredWithCitation` — ответы с источником
 * (grounding-proxy, НЕ «дефлекция»).
 */
export interface ChatV2UsageStatsApi {
  from: string;
  to: string;
  scope: 'self' | 'org';
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
  /** YYYY-MM-DD; default — начало текущего месяца. */
  from?: string;
  /** YYYY-MM-DD; default — сейчас. */
  to?: string;
  /** 'self' — мои диалоги; 'org' — по всей Org (owner/coo). Default 'self'. */
  scope?: 'self' | 'org';
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

  /**
   * TZ-1 Фаза 5 — метрика чата за окно (asked/answered/grounding-proxy/
   * helped-rate). `scope='org'` доступен owner/coo, остальным сервер вернёт
   * только self. Tenant резолвится из дефолтного `X-Org-Id` (apiClient).
   */
  usageStats: (query?: ChatV2UsageStatsQuery) => {
    const params = new URLSearchParams();
    if (query?.from) params.set('from', query.from);
    if (query?.to) params.set('to', query.to);
    if (query?.scope) params.set('scope', query.scope);
    const qs = params.toString();
    return apiClient.get<ChatV2UsageStatsApi>(
      `/api/v1/chat-v2/usage-stats${qs ? `?${qs}` : ''}`,
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

  /**
   * TZ-1 Ф5 — оценить ответ ассистента (палец вверх/вниз). Upsert по
   * (messageId, userId). Контракт: `POST /api/v1/chat-v2/messages/:id/feedback`.
   * Источник: `backend/.../chat-v2.controller.ts:setFeedback`.
   */
  setFeedback: (messageId: string, helpful: 'up' | 'down', comment?: string) =>
    apiClient.post<{ messageId: string; helpful: 'up' | 'down' }>(
      `/api/v1/chat-v2/messages/${encodeURIComponent(messageId)}/feedback`,
      comment !== undefined ? { helpful, comment } : { helpful },
    ),

  /**
   * TZ-1 Ф5 — снять оценку ответа ассистента.
   * Контракт: `DELETE /api/v1/chat-v2/messages/:id/feedback`.
   */
  clearFeedback: (messageId: string) =>
    apiClient.del<{ messageId: string; cleared: boolean }>(
      `/api/v1/chat-v2/messages/${encodeURIComponent(messageId)}/feedback`,
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
