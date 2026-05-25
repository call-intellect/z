/**
 * API-клиент журнала super_admin (admin-redesign Фаза 1).
 *
 * Контракт: backend `AdminAuditController` под префиксом `/api/v1/admin/audit`.
 * Защита — `SuperAdminGuard`. Cursor-based pagination через opaque base64
 * cursor; UI хранит его как непрозрачную строку.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';
import type {
  AdminAuditAdminsListApi,
  AdminAuditListApi,
} from '@/domain/admin-audit';

export type ListAuditRequest = {
  adminUserId?: string;
  tenantId?: string;
  route?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  from?: string; // ISO date
  to?: string; // ISO date
  cursor?: string;
  limit?: number;
};

export const adminAuditApi = {
  list: (req: ListAuditRequest) =>
    apiClient.get<AdminAuditListApi>(
      `/api/v1/admin/audit${buildQuery({ ...req })}`,
    ),

  listAdmins: () =>
    apiClient.get<AdminAuditAdminsListApi>('/api/v1/admin/audit/admins'),
};
