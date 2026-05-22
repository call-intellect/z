import { apiClient } from './api-client';
import type {
  CardApi,
  CardListApi,
  CardMeetingsListApi,
} from '@/domain/card';
import type { CardThemeMiniApi } from '@/domain/theme';

/**
 * API-клиент модуля cards. Контракт: `backend/src/modules/cards/`.
 */

export type CardKindFilter =
  | 'client'
  | 'deal'
  | 'project'
  | 'topic'
  | 'custom'
  | 'vendor';

export type ListCardsRequest = {
  page?: number;
  limit?: number;
  kind?: CardKindFilter;
  pinned?: boolean;
  archived?: boolean;
  q?: string;
  sort?: 'lastMeetingAt' | 'createdAt' | 'name';
};

export type CreateCardRequest = {
  name: string;
  kind?: CardKindFilter;
  color?: string;
  icon?: string | null;
  description?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

export type UpdateCardRequest = {
  name?: string;
  kind?: CardKindFilter;
  color?: string;
  icon?: string | null;
  description?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  pinned?: boolean;
  archived?: boolean;
};

function buildQuery(filters?: ListCardsRequest): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.page) p.set('page', String(filters.page));
  if (filters.limit) p.set('limit', String(filters.limit));
  if (filters.kind) p.set('kind', filters.kind);
  if (filters.pinned !== undefined) p.set('pinned', String(filters.pinned));
  if (filters.archived !== undefined) p.set('archived', String(filters.archived));
  if (filters.q) p.set('q', filters.q);
  if (filters.sort) p.set('sort', filters.sort);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const cardsApi = {
  list: (filters?: ListCardsRequest) =>
    apiClient.get<CardListApi>(`/api/v1/cards${buildQuery(filters)}`),

  get: (id: string) =>
    apiClient.get<CardApi>(`/api/v1/cards/${encodeURIComponent(id)}`),

  listMeetings: (id: string, page = 1, limit = 20) =>
    apiClient.get<CardMeetingsListApi>(
      `/api/v1/cards/${encodeURIComponent(id)}/meetings?page=${page}&limit=${limit}`,
    ),

  create: (body: CreateCardRequest) =>
    apiClient.post<CardApi>(`/api/v1/cards`, body),

  update: (id: string, body: UpdateCardRequest) =>
    apiClient.patch<CardApi>(`/api/v1/cards/${encodeURIComponent(id)}`, body),

  remove: (id: string) =>
    apiClient.del<void>(`/api/v1/cards/${encodeURIComponent(id)}`),

  restore: (id: string) =>
    apiClient.post<CardApi>(`/api/v1/cards/${encodeURIComponent(id)}/restore`),

  linkMeeting: (cardId: string, meetingId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/cards/${encodeURIComponent(cardId)}/meetings/${encodeURIComponent(meetingId)}`,
    ),

  unlinkMeeting: (cardId: string, meetingId: string) =>
    apiClient.del<void>(
      `/api/v1/cards/${encodeURIComponent(cardId)}/meetings/${encodeURIComponent(meetingId)}`,
    ),

  /** AI-чат по карточке (RAG среди встреч карточки). */
  ask: (cardId: string, message: string) =>
    apiClient.post<{
      message: string;
      citations: Array<{
        meetingId: string;
        meetingTitle: string;
        startMs: number;
        endMs: number;
        snippet: string;
      }>;
      modelUsed: string;
    }>(`/api/v1/cards/${encodeURIComponent(cardId)}/chat`, { message }),

  chatHistory: (cardId: string) =>
    apiClient.get<{
      items: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        createdAt: string;
        citations?: unknown;
      }>;
    }>(`/api/v1/cards/${encodeURIComponent(cardId)}/chat/history`),

  /** AI-темы, в которых блоки карточки участвуют (top-3, knowledge-core Фаза 4). */
  listThemes: (cardId: string) =>
    apiClient.get<{ items: CardThemeMiniApi[] }>(
      `/api/v1/cards/${encodeURIComponent(cardId)}/themes`,
    ),
};
