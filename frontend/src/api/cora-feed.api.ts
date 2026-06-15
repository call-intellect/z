/**
 * REST-клиент «Ленты Коры» и контроля вопросов Коры (probe/control).
 *
 * Контракт бэка (commit 35237ae4):
 *   - GET  /api/v1/feed/cora?type=&window=&limit=
 *       → { items, counters, unreadCount }
 *   - POST /api/v1/feed/cora/seen
 *       → { ok, lastSeenAt }  (обнуляет unread)
 *   - GET  /api/v1/probe/control?window=&limit=
 *       → { items, counts }
 *
 * Защита: CookieAuthGuard + TenantGuard. `tenantId` берётся из X-Org-Id,
 * который api-client подставляет из auth-context. Сигнатура `(orgId, …)`
 * сохранена явно для совместимости со слоем вызова и cross-org-сценариев.
 */

import { apiClient } from './api-client';

// ─── ApiDto: Лента Коры ──────────────────────────────────────────────────────

export type CoraFeedTypeApi =
  | 'idea'
  | 'insight'
  | 'decision'
  | 'conflict'
  | 'blocker'
  | 'activity'
  | 'probe_question'
  | 'open_question';

/** Значение `type`-параметра запроса: `all` или конкретный тип. */
export type CoraFeedTypeFilterApi = 'all' | CoraFeedTypeApi;

export type CoraFeedSeverityApi = 'info' | 'warn' | 'risk';

export interface CoraFeedSourceRefApi {
  meetingId?: string;
  cite?: string;
}

export interface CoraFeedItemApi {
  id: string;
  type: CoraFeedTypeApi;
  title: string;
  analysis?: string | null;
  severity: CoraFeedSeverityApi;
  sourceRef?: CoraFeedSourceRefApi | null;
  createdAt: string;
  unread: boolean;
  payload?: Record<string, unknown> | null;
}

export interface CoraFeedListApi {
  items: CoraFeedItemApi[];
  counters: Record<string, number>;
  unreadCount: number;
}

export interface CoraFeedSeenResponseApi {
  ok: boolean;
  lastSeenAt: string;
}

// ─── ApiDto: контроль вопросов Коры (probe/control) ──────────────────────────

export type ProbeControlStateApi =
  | 'answered'
  | 'read_silent'
  | 'unseen'
  | 'expired';

export interface ProbeControlItemApi {
  notificationId: string;
  question: string;
  recipientName?: string | null;
  askedAt: string;
  expiresAt?: string | null;
  state: ProbeControlStateApi;
  waitingDays: number;
}

export interface ProbeControlCountsApi {
  answered: number;
  read_silent: number;
  unseen: number;
  expired: number;
}

export interface ProbeControlListApi {
  items: ProbeControlItemApi[];
  counts: ProbeControlCountsApi;
}

// ─── Параметры запросов ──────────────────────────────────────────────────────

export type CoraFeedListParams = {
  type?: CoraFeedTypeFilterApi;
  /** Окно в днях (число) или `'all'`. */
  window?: number | 'all';
  limit?: number;
};

export type ProbeControlListParams = {
  window?: number | 'all';
  limit?: number;
};

function withOrgHeader(orgId: string | null | undefined): {
  headers?: Record<string, string>;
} {
  return orgId ? { headers: { 'X-Org-Id': orgId } } : {};
}

// ─── Клиенты ──────────────────────────────────────────────────────────────────

export const coraFeedApi = {
  list: (orgId: string | null, params?: CoraFeedListParams) => {
    const p = new URLSearchParams();
    if (params?.type && params.type !== 'all') p.set('type', params.type);
    else p.set('type', 'all');
    if (params?.window !== undefined) p.set('window', String(params.window));
    if (params?.limit !== undefined) p.set('limit', String(params.limit));
    const qs = p.toString();
    return apiClient.get<CoraFeedListApi>(
      `/api/v1/feed/cora${qs ? `?${qs}` : ''}`,
      withOrgHeader(orgId),
    );
  },

  markSeen: (orgId: string | null) =>
    apiClient.post<CoraFeedSeenResponseApi>(
      '/api/v1/feed/cora/seen',
      {},
      withOrgHeader(orgId),
    ),
};

export const probeControlApi = {
  list: (orgId: string | null, params?: ProbeControlListParams) => {
    const p = new URLSearchParams();
    if (params?.window !== undefined) p.set('window', String(params.window));
    if (params?.limit !== undefined) p.set('limit', String(params.limit));
    const qs = p.toString();
    return apiClient.get<ProbeControlListApi>(
      `/api/v1/probe/control${qs ? `?${qs}` : ''}`,
      withOrgHeader(orgId),
    );
  },
};
