import { apiClient } from './api-client';
import type {
  DirectorDashboardApi,
  DirectorDashboardPeriod,
} from '@/domain/director-dashboard';

/**
 * API-клиент модуля dashboard (Фаза 8 knowledge-core).
 *
 * Контракт: `backend/src/modules/dashboard/director-dashboard.controller.ts`.
 *
 *   GET /api/v1/dashboard/director?period=week|month
 *
 * Доступ: owner / admin / super_admin (RbacService.canViewDirectorDashboard).
 * Manager → 403 forbidden_role.
 */
export const dashboardApi = {
  getDirectorView: (period: DirectorDashboardPeriod) =>
    apiClient.get<DirectorDashboardApi>(
      `/api/v1/dashboard/director?period=${encodeURIComponent(period)}`,
    ),
};
