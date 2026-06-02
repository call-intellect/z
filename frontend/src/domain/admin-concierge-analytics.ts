/**
 * Доменная модель для админ-аналитики Concierge / AI-чат (Фаза 2 редизайна).
 *
 * Контракт: backend `GET /api/v1/admin/analytics/concierge/{overview,top-queries,no-answer}`.
 * Бэкенд отдаёт ПЛОСКИЕ объекты — типы ниже синхронизированы с фактическим
 * ответом `ConciergeAnalyticsService` (см.
 * backend/src/modules/admin/analytics/concierge-analytics.service.ts).
 *
 * Слой: ApiDto → DomainModel (Date).
 */

import type { AdminPeriod } from './admin-usage';

// ─── Overview ───────────────────────────────────────────────────────────────

/**
 * Фактический ПЛОСКИЙ ответ бэка `/overview`.
 * `noAnswerRate` / `avgLatencyMs` — nullable (нет данных за период / нет поля).
 */
export type AdminConciergeOverviewApi = {
  period: AdminPeriod;
  from: string;
  to: string;
  totalQuestions: number;
  noAnswerRate: number | null;
  avgLatencyMs: number | null;
  activeUsers: number;
  noAnswerCount: number;
  notes: {
    noAnswerRateIsHeuristic: boolean;
    avgLatencyAvailable: boolean;
  };
};

/**
 * Доменная модель. `from/to` → `Date`. Для удобства компонента собираем
 * `totals` из плоских полей (но без обращения к недоставленным значениям).
 */
export type AdminConciergeOverviewDomain = {
  period: { from: Date; to: Date; kind: AdminPeriod };
  totals: {
    totalQuestions: number;
    noAnswerCount: number;
    noAnswerRate: number | null;
    avgLatencyMs: number | null;
    activeUsers: number;
  };
  notes: AdminConciergeOverviewApi['notes'];
};

export function adminConciergeOverviewFromApi(
  api: AdminConciergeOverviewApi,
): AdminConciergeOverviewDomain {
  return {
    period: {
      from: new Date(api.from),
      to: new Date(api.to),
      kind: api.period,
    },
    totals: {
      totalQuestions: api.totalQuestions,
      noAnswerCount: api.noAnswerCount,
      noAnswerRate: api.noAnswerRate,
      avgLatencyMs: api.avgLatencyMs,
      activeUsers: api.activeUsers,
    },
    notes: api.notes,
  };
}

// ─── Top queries ────────────────────────────────────────────────────────────

/** Фактический ответ бэка `/top-queries` — только `{ query, count }`. */
export type AdminConciergeTopQueryApi = {
  query: string;
  count: number;
};

export type AdminConciergeTopQueriesApi = {
  items: AdminConciergeTopQueryApi[];
};

export type AdminConciergeTopQueriesDomain = AdminConciergeTopQueriesApi;

export function adminConciergeTopQueriesFromApi(
  api: AdminConciergeTopQueriesApi,
): AdminConciergeTopQueriesDomain {
  return api;
}

// ─── No-answer feed ─────────────────────────────────────────────────────────

/**
 * Фактический ответ бэка `/no-answer`. Ключ строки — `messageId` (НЕ `id`);
 * полей `tenantName`/`reason` бэк не отдаёт.
 */
export type AdminConciergeNoAnswerRowApi = {
  messageId: string;
  conversationId: string;
  tenantId: string | null;
  userId: string | null;
  userEmail: string | null;
  query: string;
  createdAt: string;
};

export type AdminConciergeNoAnswerApi = {
  items: AdminConciergeNoAnswerRowApi[];
  nextCursor?: string | null;
};

export type AdminConciergeNoAnswerRowDomain = Omit<
  AdminConciergeNoAnswerRowApi,
  'createdAt'
> & {
  createdAt: Date;
};

export type AdminConciergeNoAnswerDomain = {
  items: AdminConciergeNoAnswerRowDomain[];
  nextCursor: string | null;
};

export function adminConciergeNoAnswerFromApi(
  api: AdminConciergeNoAnswerApi,
): AdminConciergeNoAnswerDomain {
  return {
    items: api.items.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })),
    nextCursor: api.nextCursor ?? null,
  };
}
