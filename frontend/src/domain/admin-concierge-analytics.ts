/**
 * Доменная модель для админ-аналитики Concierge / AI-чат (Фаза 2 редизайна).
 *
 * Контракт: backend `GET /api/v1/admin/analytics/concierge/{overview,top-queries,no-answer}`.
 * Бэкенд готовится параллельно — здесь только TypeScript-типы.
 *
 * Слой: ApiDto → DomainModel (Date).
 */

import type { AdminPeriod } from './admin-usage';

// ─── Overview ───────────────────────────────────────────────────────────────

export type AdminConciergeOverviewApi = {
  period: { from: string; to: string; kind: AdminPeriod };
  totals: {
    totalQuestions: number;
    noAnswerCount: number;
    noAnswerRate: number;
    avgLatencyMs: number;
    activeUsers: number;
  };
};

export type AdminConciergeOverviewDomain = {
  period: { from: Date; to: Date; kind: AdminPeriod };
  totals: AdminConciergeOverviewApi['totals'];
};

export function adminConciergeOverviewFromApi(
  api: AdminConciergeOverviewApi,
): AdminConciergeOverviewDomain {
  return {
    period: {
      from: new Date(api.period.from),
      to: new Date(api.period.to),
      kind: api.period.kind,
    },
    totals: api.totals,
  };
}

// ─── Top queries ────────────────────────────────────────────────────────────

export type AdminConciergeTopQueryApi = {
  query: string;
  count: number;
  avgLatencyMs: number;
  successRate: number;
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

export type AdminConciergeNoAnswerRowApi = {
  id: string;
  createdAt: string;
  query: string;
  userId: string | null;
  userEmail: string | null;
  tenantId: string | null;
  tenantName: string | null;
  reason: string | null;
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
