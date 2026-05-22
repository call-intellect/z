/**
 * API-клиент модуля events (SBA α-3 — категория A онтологии).
 * Контракт: `backend/src/modules/events/`.
 *
 * Эндпоинты:
 *   - GET /api/v1/events?kind=&from=&to=&q=&page=&limit=
 *   - GET /api/v1/events/:id
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `event_card:read`.
 */

import { apiClient } from './api-client';

export type EventKindApi =
  | 'meeting'
  | 'incident'
  | 'release'
  | 'transition'
  | 'milestone'
  | 'other';

export interface EventListItemApi {
  id: string;
  entityId: string;
  kind: EventKindApi;
  title: string;
  startAt: string;
  endAt: string | null;
  durationMin: number | null;
  location: string | null;
  relatedMeetingId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface EventApi extends EventListItemApi {
  participantsPersonIds: string[];
  outcomeSummary: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EventsListResponseApi {
  items: EventListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type ListEventsRequest = {
  page?: number;
  limit?: number;
  kind?: EventKindApi;
  from?: string; // ISO-8601
  to?: string;
  q?: string;
};

function buildEventsQuery(filters?: ListEventsRequest): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.page) p.set('page', String(filters.page));
  if (filters.limit) p.set('limit', String(filters.limit));
  if (filters.kind) p.set('kind', filters.kind);
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.q) p.set('q', filters.q);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const eventsApi = {
  list: (filters?: ListEventsRequest) =>
    apiClient.get<EventsListResponseApi>(
      `/api/v1/events${buildEventsQuery(filters)}`,
    ),

  get: (id: string) =>
    apiClient.get<EventApi>(`/api/v1/events/${encodeURIComponent(id)}`),
};
