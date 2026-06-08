/**
 * ТЗ-2 Ф6.A (daily-value-dashboards) — API-клиент «Здоровье портфеля целей».
 *
 * Контракт: `GET /api/v1/dashboard/operations/portfolio-health?date=YYYY-MM-DD`
 * (см. `backend/src/modules/operations/dto/portfolio-health.dto.ts`).
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

/** MoSCoW-приоритет цели (+ 'none' для нераспределённых). */
export type PortfolioPriorityKey = 'must' | 'should' | 'could' | 'wont' | 'none';

/** Статус движения цели (зеркало backend `GoalProgressStatusKey`). */
export type PortfolioProgressStatusKey =
  | 'on_track'
  | 'at_risk'
  | 'stalled'
  | 'achieved'
  | 'dropped';

export type PortfolioHealthLevelApi = 'healthy' | 'warning' | 'critical';

export interface PortfolioPriorityBucketApi {
  count: number;
  achievedCount: number;
  achievedPercent: number;
}

export type PortfolioByPriorityApi = Record<
  PortfolioPriorityKey,
  PortfolioPriorityBucketApi
>;

export type PortfolioByStatusApi = Record<PortfolioProgressStatusKey, number>;

export interface PortfolioRowReasonApi {
  sourceBlockId: string;
}

export interface PortfolioHealthRowApi {
  goalId: string;
  name: string;
  progressStatus: string;
  /** MoSCoW-приоритет; null — без приоритета (для рядов список не агрегирует 'none'). */
  priority: 'must' | 'should' | 'could' | 'wont' | null;
  reason: PortfolioRowReasonApi | null;
}

export interface PortfolioHealthScaleApi {
  healthy: number;
  warning: number;
  level: PortfolioHealthLevelApi;
}

export interface PortfolioHealthApi {
  healthScore: number;
  scale: PortfolioHealthScaleApi;
  byStatus: PortfolioByStatusApi;
  byPriority: PortfolioByPriorityApi;
  rows: PortfolioHealthRowApi[];
  deltaVsPrevWeek: number | null;
}

export const portfolioHealthApi = {
  /**
   * `GET /dashboard/operations/portfolio-health?date=YYYY-MM-DD`.
   * `date` не передан — backend резолвит сегодня. Доступ: owner/admin/coo.
   */
  get: (orgId: string, date?: string) =>
    apiClient.get<PortfolioHealthApi>(
      `/api/v1/dashboard/operations/portfolio-health${buildQuery({ date })}`,
      { headers: orgHeaders(orgId) },
    ),
};
