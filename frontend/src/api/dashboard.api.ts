import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';
import type {
  DirectorDashboardApi,
  DirectorDashboardPeriod,
} from '@/domain/director-dashboard';
import type { PeopleAtRiskResponseApi } from '@/domain/people-at-risk';
import type { PulsePatternsApi } from '@/domain/pulse-patterns';
import type { TeamDetailApi } from '@/domain/team-detail';
import type { TeamHealthApi } from '@/domain/team-health';

/**
 * API-клиент модуля dashboard (Фаза 8 knowledge-core + Pulse Wave 1-2).
 *
 * Контракт: `backend/src/modules/dashboard/director-dashboard.controller.ts`.
 *
 *   GET /api/v1/dashboard/director?period=week|month
 *   GET /api/v1/dashboard/team-health
 *   GET /api/v1/dashboard/teams/:id   (Pulse Wave 2 §2.5)
 *
 * Доступ: owner / admin / super_admin (RbacService.canViewDirectorDashboard).
 * Manager → 403 forbidden_role.
 *
 * ВАЖНО: эти эндпоинты НЕ содержат `:orgId` в пути, поэтому tenant резолвится
 * только из заголовка `X-Org-Id` (его ставит `TenantMiddleware` ДО глобального
 * `EntitlementGuard`/`SubscriptionGuard`). Без заголовка → 403 `tenant_required`.
 * Поэтому каждый метод обязан принимать `orgId` и слать `orgHeaders(orgId)`.
 */
export const dashboardApi = {
  getDirectorView: (orgId: string, period: DirectorDashboardPeriod) =>
    apiClient.get<DirectorDashboardApi>(
      `/api/v1/dashboard/director?period=${encodeURIComponent(period)}`,
      { headers: orgHeaders(orgId) },
    ),
  /**
   * Pulse Wave 1 §1.6 — Team Health Grid (per-dept агрегаты по 4 метрикам).
   */
  getTeamHealth: (orgId: string) =>
    apiClient.get<TeamHealthApi>('/api/v1/dashboard/team-health', {
      headers: orgHeaders(orgId),
    }),
  /**
   * Pulse Wave 2 §2.5 — детальная страница `/teams/[id]`.
   * 404 → ApiError code='department_not_found'.
   */
  getTeamDetail: (orgId: string, id: string) =>
    apiClient.get<TeamDetailApi>(
      `/api/v1/dashboard/teams/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
  /**
   * Pulse Wave 6 — единый агрегатор паттернов для главной директора
   * (7 виджетов в одном ответе). Источник: `PulsePatternsService`.
   */
  getPulsePatterns: (orgId: string, period: 'week' | 'month') =>
    apiClient.get<PulsePatternsApi>(
      `/api/v1/dashboard/pulse-patterns?period=${encodeURIComponent(period)}`,
      { headers: orgHeaders(orgId) },
    ),
  /**
   * ТЗ-G Фаза 1-2 — «Сотрудники под риском» (топ-N по pulseScore ASC).
   * Серверное ранжирование, готовая фраза-действие `topReason` на каждого.
   * Доступ: owner / admin / super_admin (canViewDirectorDashboard).
   */
  peopleAtRisk: (orgId: string, limit = 3) =>
    apiClient.get<PeopleAtRiskResponseApi>(
      `/api/v1/dashboard/people-at-risk?limit=${encodeURIComponent(limit)}`,
      { headers: orgHeaders(orgId) },
    ),
};
