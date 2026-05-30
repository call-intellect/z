import { apiClient } from './api-client';
import type {
  DirectorDashboardApi,
  DirectorDashboardPeriod,
} from '@/domain/director-dashboard';
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
 */
export const dashboardApi = {
  getDirectorView: (period: DirectorDashboardPeriod) =>
    apiClient.get<DirectorDashboardApi>(
      `/api/v1/dashboard/director?period=${encodeURIComponent(period)}`,
    ),
  /**
   * Pulse Wave 1 §1.6 — Team Health Grid (per-dept агрегаты по 4 метрикам).
   */
  getTeamHealth: () => apiClient.get<TeamHealthApi>('/api/v1/dashboard/team-health'),
  /**
   * Pulse Wave 2 §2.5 — детальная страница `/teams/[id]`.
   * 404 → ApiError code='department_not_found'.
   */
  getTeamDetail: (id: string) =>
    apiClient.get<TeamDetailApi>(
      `/api/v1/dashboard/teams/${encodeURIComponent(id)}`,
    ),
};
