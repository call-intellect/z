/**
 * API-клиент для Org-Admin usage (Фаза 7).
 *
 * Контракт: `backend/src/modules/admin/controllers/org-admin-usage.controller.ts`.
 * Защита — `OrgAdminGuard` (owner|admin Membership).
 *
 * Все запросы передают `X-Org-Id` заголовок (см. `orgHeaders`). Org-id
 * подаётся из текущего auth-context.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';
import type {
  AdminCallDetailApi,
  AdminCallsLogApi,
  AdminDashboardApi,
  AdminFunctionsUsageApi,
  AdminUsersUsageApi,
} from '@/domain/admin-usage';
import type {
  CallsLogRequest,
  DashboardRequest,
  ExportCsvRequest,
  FunctionsUsageRequest,
  UsersUsageRequest,
} from './admin-usage.api';

export const orgAdminUsageApi = {
  getDashboard: (orgId: string, req: DashboardRequest) =>
    apiClient.get<AdminDashboardApi>(
      `/api/v1/org-admin/usage/dashboard${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  getUsers: (orgId: string, req: UsersUsageRequest) =>
    apiClient.get<AdminUsersUsageApi>(
      `/api/v1/org-admin/usage/users${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  getCalls: (orgId: string, req: CallsLogRequest) =>
    apiClient.get<AdminCallsLogApi>(
      `/api/v1/org-admin/usage/calls${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  getCallDetails: (orgId: string, callId: string) =>
    apiClient.get<AdminCallDetailApi>(
      `/api/v1/org-admin/usage/calls/${encodeURIComponent(callId)}`,
      { headers: orgHeaders(orgId) },
    ),

  getFunctions: (orgId: string, req: FunctionsUsageRequest) =>
    apiClient.get<AdminFunctionsUsageApi>(
      `/api/v1/org-admin/usage/functions${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * URL для прямой загрузки CSV. Org-id передаётся в URL ради предсказуемости
   * (header не работает при <a download>). Backend поддерживает `X-Org-Id`
   * приоритетнее, но для CSV-стрима оставляем привязку к фактической Org через cookie.
   *
   * NB: текущий endpoint требует `X-Org-Id`. Workaround для скачивания —
   * использовать `fetch` с blob (см. компонент CSV-кнопки) вместо anchor.
   */
  exportCsvUrl: (req: ExportCsvRequest) =>
    `/api/v1/org-admin/usage/export/usage.csv${buildQuery({ ...req })}`,
};
